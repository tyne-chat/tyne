// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: an animated AVIF upload becomes an animated WebP before the attachment pipeline reads it
 * (tyne-chat/tyne#854).
 *
 * The media proxy reads no animated AVIF as an image (libvips does not know the `avis` brand), so
 * such an attachment used to be stored as a plain file: no size, no preview, no NSFW check and no
 * stripping. The media proxy's `/_fork/animated_avif_to_webp` decodes every frame and encodes them
 * as an animated WebP, which replaces the upload, so everything after this step (metadata, NSFW
 * check, stripping, previews) sees an ordinary animated WebP. The file name's extension becomes
 * `.webp`.
 *
 * - Only an upload whose `ftyp` box names the `avis` brand goes to the media proxy: one request
 *   per animated AVIF attachment, none for anything else.
 * - The original's SHA-256 is checked against the moderation hash list before it is replaced, as
 *   the pipeline checks the hash of what it stores.
 * - Longer or larger than the media proxy decodes: the message is refused
 *   (`ANIMATION_TOO_LARGE_TO_CONVERT`). Any other failure keeps the upload as it was, as when
 *   another conversion fails, and is logged.
 */

import fs from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';
import {Config} from '@app/api/Config';
import type {AttachmentToProcess} from '@app/api/channel/AttachmentDTOs';
import {contentModerationService} from '@app/api/infrastructure/ContentModerationService';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';
import {Logger} from '@app/api/Logger';
import type {Message} from '@app/api/models/Message';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {ContentBlockedError} from '@fluxer/errors/src/domains/content/ContentBlockedError';
import {BadRequestError} from '@fluxer/errors/src/domains/core/BadRequestError';
import {ms} from 'itty-time';
import {temporaryFile} from 'tempy';

export const FORK_ANIMATED_AVIF_CONVERSION_PATH = '/_fork/animated_avif_to_webp';
/** The media proxy gives a conversion two minutes; this waits a little longer. */
const CONVERSION_TIMEOUT_MS = ms('2 minutes') + ms('30 seconds');
/** Enough for the `ftyp` box of any encoder seen: brands are four bytes each. */
const FTYP_READ_BYTES = 256;

class AnimationTooLargeToConvertError extends BadRequestError {
	constructor() {
		super({
			code: APIErrorCodes.ANIMATION_TOO_LARGE_TO_CONVERT,
			message: 'This animated image is too long or too large to process',
		});
	}
}

/**
 * Whether these bytes start with an `ftyp` box that names the `avis` brand (an animated AVIF), as
 * the media proxy's sniffing decides it.
 */
export function startsAsAnimatedAvif(head: Uint8Array): boolean {
	if (head.length < 16) return false;
	const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
	const boxSize = view.getUint32(0);
	if (boxSize < 16 || ascii(head, 4) !== 'ftyp') return false;
	const end = Math.min(boxSize, head.length);
	if (ascii(head, 8) === 'avis') return true;
	for (let offset = 16; offset + 4 <= end; offset += 4) {
		if (ascii(head, offset) === 'avis') return true;
	}
	return false;
}

function ascii(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/** `name.webp`: the last extension replaced, or added when there is none. */
export function webpFilename(filename: string): string {
	const dot = filename.lastIndexOf('.');
	const stem = dot > 0 ? filename.slice(0, dot) : filename;
	return `${stem}.webp`;
}

interface ForkAnimatedAvifUpload {
	/** Its `filename` is changed to `.webp` when the upload is converted. */
	attachment: AttachmentToProcess;
	/** Its `content_type` is changed to `image/webp` when the upload is converted. */
	pendingUpload: {content_type: string};
	/** Its `contentLength` and `contentType` are changed to the WebP's when the upload is converted. */
	uploadedFile: {contentLength: number; contentType: string};
	bucket: string;
	key: string;
	message: Message;
	storageService: IStorageService;
}

/**
 * Converts the upload at `bucket`/`key` in place when it is an animated AVIF, and updates the
 * attachment's file name, the pending upload's content type and the object's size to match.
 * Throws `AnimationTooLargeToConvertError` when the media proxy refuses it as too large, and
 * `ContentBlockedError` when the original's hash is on the moderation list.
 */
export async function forkConvertAnimatedAvifUpload(upload: ForkAnimatedAvifUpload): Promise<void> {
	const {attachment, pendingUpload, uploadedFile, bucket, key, message, storageService} = upload;
	if (!(await isAnimatedAvifObject(storageService, bucket, key))) return;

	const originalHash = await storageService.computeObjectSha256(bucket, key);
	try {
		contentModerationService.scanSha256(originalHash, {
			userId: message.authorId ?? null,
			guildId: null,
			channelId: message.channelId,
			messageId: message.id,
			surface: 'message_attachment',
		});
	} catch (error) {
		if (error instanceof ContentBlockedError) {
			await storageService.deleteObject(bucket, key);
		}
		throw error;
	}

	const outputPath = temporaryFile();
	try {
		const outcome = await requestConversion(bucket, key, outputPath);
		if (outcome.kind === 'too_large') {
			throw new AnimationTooLargeToConvertError();
		}
		if (outcome.kind === 'failed') {
			Logger.warn(
				{bucket, key, filename: attachment.filename, status: outcome.status, reason: outcome.reason},
				'Animated AVIF not converted; storing the upload as it is',
			);
			return;
		}
		const {size: contentLength} = await fs.promises.stat(outputPath);
		await storageService.uploadObjectFromFile({
			bucket,
			key,
			filePath: outputPath,
			contentType: 'image/webp',
			contentLength,
		});
		Logger.info(
			{
				bucket,
				key,
				filename: attachment.filename,
				originalBytes: uploadedFile.contentLength,
				webpBytes: contentLength,
				frames: outcome.frames,
			},
			'Animated AVIF converted to animated WebP',
		);
		attachment.filename = webpFilename(attachment.filename);
		pendingUpload.content_type = 'image/webp';
		uploadedFile.contentLength = contentLength;
		uploadedFile.contentType = 'image/webp';
	} finally {
		await fs.promises.rm(outputPath, {force: true});
	}
}

async function isAnimatedAvifObject(storageService: IStorageService, bucket: string, key: string): Promise<boolean> {
	try {
		const object = await storageService.streamObject({bucket, key, range: `bytes=0-${FTYP_READ_BYTES - 1}`});
		if (!object) return false;
		const chunks: Array<Buffer> = [];
		let length = 0;
		for await (const chunk of object.body) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			chunks.push(buffer);
			length += buffer.length;
			if (length >= FTYP_READ_BYTES) break;
		}
		object.body.destroy();
		return startsAsAnimatedAvif(Buffer.concat(chunks).subarray(0, FTYP_READ_BYTES));
	} catch (error) {
		Logger.warn({error, bucket, key}, 'Could not read the start of an upload to check for animated AVIF');
		return false;
	}
}

type ConversionOutcome =
	| {kind: 'converted'; frames: number | null}
	| {kind: 'too_large'}
	| {kind: 'failed'; status: number | null; reason: string};

async function requestConversion(bucket: string, key: string, outputPath: string): Promise<ConversionOutcome> {
	let response: Response;
	try {
		response = await fetch(
			`http://${Config.mediaProxy.host}:${Config.mediaProxy.port}${FORK_ANIMATED_AVIF_CONVERSION_PATH}`,
			{
				method: 'POST',
				body: JSON.stringify({type: 's3', bucket, key}),
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${Config.mediaProxy.secretKey}`,
				},
				signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
			},
		);
	} catch (error) {
		return {kind: 'failed', status: null, reason: error instanceof Error ? error.message : String(error)};
	}
	if (response.status === 413) {
		await response.text().catch(() => '');
		return {kind: 'too_large'};
	}
	if (!response.ok || !response.body) {
		const reason = await response.text().catch(() => '');
		return {kind: 'failed', status: response.status, reason: reason.slice(0, 200)};
	}
	try {
		await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), fs.createWriteStream(outputPath));
	} catch (error) {
		return {
			kind: 'failed',
			status: response.status,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	const frames = Number.parseInt(response.headers.get('x-tyne-animation-frames') ?? '', 10);
	return {kind: 'converted', frames: Number.isFinite(frames) ? frames : null};
}
