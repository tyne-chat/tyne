// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fork: an audio attachment's cover and waveform, for the audio player (tyne-chat/tyne#873).
 *
 * For every audio upload the media proxy's `/_fork/audio_extras` reads the file once and answers its
 * embedded cover, cleaned of metadata like an image upload, and its waveform, computed as the web
 * app computes a voice message's. One request per audio attachment, none for anything else.
 *
 * - The waveform goes into the attachment's `waveform`, unless the client sent one (a voice
 *   message's own). The clients use the voice message player only for messages flagged as voice
 *   messages, so a waveform on any other audio file changes nothing there. The waveform is also
 *   stored at `attachment-waveforms/<channel>/<attachment>`, for links to the attachment, whose
 *   embeds have no waveform field; the media proxy serves it from the attachment's URL with
 *   `waveform=1` (`infrastructure/ForkLinkedAudioExtras.ts`).
 * - The cover gets an image upload's checks: the NSFW check (a cover that is or might be explicit
 *   is left out, while the audio itself is kept: the uploader chose to send a sound, not a picture)
 *   and the moderation hash list (a blocked cover blocks the message, as a blocked image does). It is
 *   stored at `attachment-covers/<channel>/<attachment>` in the cdn bucket, and the attachment gets
 *   `ForkMessageAttachmentFlags.HAS_COVER`. The media proxy serves it from the attachment's own URL
 *   with `cover=1`.
 * - Anything else that fails (the proxy unreachable, a timeout, a file FFmpeg cannot open) leaves
 *   the attachment as it was, without a cover or waveform, and is logged.
 * - Both objects are deleted with the attachment and copied with a forward.
 */
import {createHash} from 'node:crypto';
import type {ChannelID} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import {contentModerationService} from '@app/api/infrastructure/ContentModerationService';
import type {IMediaService, MediaProxyNsfwMode} from '@app/api/infrastructure/IMediaService';
import {type IStorageService, isStorageObjectMissing} from '@app/api/infrastructure/IStorageService';
import {Logger} from '@app/api/Logger';
import type {Message} from '@app/api/models/Message';
import {ForkMessageAttachmentFlags} from '@fluxer/constants/src/ForkAttachmentConstants';
import {ExplicitContentCannotBeSentError} from '@fluxer/errors/src/domains/moderation/ExplicitContentCannotBeSentError';
import {getContentTypeFromFilename} from '@pkgs/mime_utils/src/ContentTypeUtils';
import {ms} from 'itty-time';

export const FORK_AUDIO_EXTRAS_PATH = '/_fork/audio_extras';
/** The media proxy gives the decode 30 seconds; this waits a little longer. */
const EXTRAS_TIMEOUT_MS = ms('40 seconds');

interface AudioExtrasResponse {
	waveform: string | null;
	cover: {base64: string; content_type: string; width: number; height: number} | null;
}

/** The fields of an attachment being processed that this step reads or sets. */
interface AudioAttachmentFields {
	attachment_id: bigint;
	content_type: string;
	flags: number;
	waveform: string | null;
}

export function forkAttachmentCoverKey(channelId: ChannelID | bigint, attachmentId: bigint): string {
	return `attachment-covers/${channelId}/${attachmentId}`;
}

/** Where an attachment's waveform is stored for links to it: its raw bytes, 0-255 each. */
export function forkAttachmentWaveformKey(channelId: ChannelID | bigint, attachmentId: bigint): string {
	return `attachment-waveforms/${channelId}/${attachmentId}`;
}

/**
 * Reads the cover and waveform of an audio attachment and sets them on `attachment` (see the file's
 * comment). Does nothing for an attachment that is not audio.
 */
export async function forkAddAudioExtras(params: {
	attachment: AudioAttachmentFields;
	channelId: ChannelID;
	bucket: string;
	key: string;
	nsfwMode: MediaProxyNsfwMode;
	message: Message;
	mediaService: IMediaService;
	storageService: IStorageService;
}): Promise<void> {
	const {attachment} = params;
	if (!attachment.content_type.startsWith('audio/')) return;
	const extras = await readAudioExtras(params.bucket, params.key, attachment.attachment_id);
	if (attachment.waveform == null && extras?.waveform) {
		attachment.waveform = extras.waveform;
	}
	if (attachment.waveform) {
		await keepWaveform({...params, waveform: attachment.waveform});
	}
	if (extras?.cover && (await keepCover({...params, cover: extras.cover}))) {
		attachment.flags |= ForkMessageAttachmentFlags.HAS_COVER;
	}
}

/** Stores the waveform for links to the attachment; a failure costs only those links' waveform. */
async function keepWaveform(params: {
	attachment: AudioAttachmentFields;
	waveform: string;
	channelId: ChannelID;
	storageService: IStorageService;
}): Promise<void> {
	const key = forkAttachmentWaveformKey(params.channelId, params.attachment.attachment_id);
	try {
		await params.storageService.uploadObject({
			bucket: Config.s3.buckets.cdn,
			key,
			body: Buffer.from(params.waveform, 'base64'),
			contentType: 'application/octet-stream',
		});
	} catch (error) {
		Logger.warn({error, key}, 'Audio attachment waveform not stored for links to it');
	}
}

async function readAudioExtras(bucket: string, key: string, attachmentId: bigint): Promise<AudioExtrasResponse | null> {
	try {
		const response = await fetch(
			`http://${Config.mediaProxy.host}:${Config.mediaProxy.port}${FORK_AUDIO_EXTRAS_PATH}`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${Config.mediaProxy.secretKey}`,
				},
				body: JSON.stringify({type: 's3', bucket, key}),
				signal: AbortSignal.timeout(EXTRAS_TIMEOUT_MS),
			},
		);
		if (!response.ok) {
			Logger.warn(
				{attachmentId: attachmentId.toString(), status: response.status, reason: await response.text()},
				'Audio attachment has no cover or waveform: the media proxy could not read it',
			);
			return null;
		}
		return (await response.json()) as AudioExtrasResponse;
	} catch (error) {
		Logger.warn(
			{error, attachmentId: attachmentId.toString()},
			'Audio attachment has no cover or waveform: the media proxy did not answer',
		);
		return null;
	}
}

async function keepCover(params: {
	attachment: AudioAttachmentFields;
	cover: NonNullable<AudioExtrasResponse['cover']>;
	channelId: ChannelID;
	nsfwMode: MediaProxyNsfwMode;
	message: Message;
	mediaService: IMediaService;
	storageService: IStorageService;
}): Promise<boolean> {
	const {cover, attachment} = params;
	const attachmentId = attachment.attachment_id.toString();
	try {
		const metadata = await params.mediaService.getMetadata({
			type: 'base64',
			base64: cover.base64,
			nsfw: params.nsfwMode,
		});
		if (!metadata || metadata.nsfw) {
			Logger.info(
				{attachmentId, checked: metadata != null},
				'Audio attachment cover left out: it may be explicit, or could not be checked',
			);
			return false;
		}
	} catch (error) {
		if (!(error instanceof ExplicitContentCannotBeSentError)) {
			Logger.warn({error, attachmentId}, 'Audio attachment cover left out: it could not be checked');
		}
		return false;
	}
	const bytes = Buffer.from(cover.base64, 'base64');
	contentModerationService.scanSha256(createHash('sha256').update(bytes).digest('hex'), {
		userId: params.message.authorId ?? null,
		guildId: null,
		channelId: params.message.channelId,
		messageId: params.message.id,
		surface: 'message_attachment',
	});
	await params.storageService.uploadObject({
		bucket: Config.s3.buckets.cdn,
		key: forkAttachmentCoverKey(params.channelId, attachment.attachment_id),
		body: bytes,
		contentType: cover.content_type,
	});
	return true;
}

/**
 * The cover and waveform keys of `attachments`, to be deleted with them: the cover of those flagged
 * with one, the waveform of those that have one.
 */
export function forkAttachmentExtraKeys(
	channelId: ChannelID | bigint,
	attachments: Iterable<{id: bigint; flags: number; waveform: string | null}>,
): Array<string> {
	const keys: Array<string> = [];
	for (const attachment of attachments) {
		if ((attachment.flags & ForkMessageAttachmentFlags.HAS_COVER) !== 0) {
			keys.push(forkAttachmentCoverKey(channelId, attachment.id));
		}
		if (attachment.waveform) {
			keys.push(forkAttachmentWaveformKey(channelId, attachment.id));
		}
	}
	return keys;
}

/**
 * Whether an attachment with this file name may have a cover or a stored waveform: an audio file.
 * For the expiry task, which knows an attachment only by its name.
 */
export function forkMayHaveCover(filename: string): boolean {
	return getContentTypeFromFilename(filename).startsWith('audio/');
}

/** The cover key of an audio file stored like an attachment, `attachments/<channel>/<attachment>/<file>`. */
function coverKeyOfStoredFile(storageKey: string): string | null {
	const [prefix, channelId, attachmentId, ...name] = storageKey.split('/');
	if (prefix !== 'attachments' || !/^\d{1,20}$/u.test(channelId ?? '') || !/^\d{1,20}$/u.test(attachmentId ?? '')) {
		return null;
	}
	if (name.length === 0 || !forkMayHaveCover(name.join('/'))) return null;
	return forkAttachmentCoverKey(BigInt(channelId!), BigInt(attachmentId!));
}

/**
 * Copies the cover of the audio file stored at `sourceKey` to the one stored at `destinationKey`,
 * when it has one: saving an audio attachment to saved media (which stores its copy like an
 * attachment of the user's own channel), and sending it from there. The stored copy of a WAV, AAC or
 * Ogg file has no cover inside it (see `fork_strip_av_metadata`), so the cover travels on its own.
 * Answers `HAS_COVER` when it copied one, else 0.
 */
export async function forkCopyStoredCover(
	storageService: IStorageService,
	sourceKey: string,
	destinationKey: string,
): Promise<number> {
	const from = coverKeyOfStoredFile(sourceKey);
	const to = coverKeyOfStoredFile(destinationKey);
	if (!from || !to) return 0;
	try {
		await storageService.copyObject({
			sourceBucket: Config.s3.buckets.cdn,
			sourceKey: from,
			destinationBucket: Config.s3.buckets.cdn,
			destinationKey: to,
		});
		return ForkMessageAttachmentFlags.HAS_COVER;
	} catch (error) {
		if (!isStorageObjectMissing(error)) Logger.warn({error, from, to}, 'Audio cover not copied with the file');
		return 0;
	}
}

/** Deletes the cover copied with a saved media file (`forkCopyStoredCover`), if it has one. */
export async function forkDeleteStoredCover(storageService: IStorageService, storageKey: string): Promise<void> {
	const key = coverKeyOfStoredFile(storageKey);
	if (!key) return;
	try {
		await storageService.deleteObject(Config.s3.buckets.cdn, key);
	} catch (error) {
		Logger.warn({error, key}, 'Saved audio cover not deleted');
	}
}

/**
 * Copies a cloned attachment's cover and stored waveform with it (a forward), and lists the new keys
 * with the copies to undo if the forward fails. One that is gone is skipped; the player then shows no
 * art, or a link to the copy no waveform.
 */
export async function forkCopyAttachmentExtras(params: {
	storageService: IStorageService;
	attachment: {id: bigint; flags: number; waveform: string | null};
	sourceChannelId: ChannelID;
	destinationChannelId: ChannelID;
	newAttachmentId: bigint;
	copyKeys: Array<string>;
}): Promise<void> {
	const copies: Array<(channelId: ChannelID, attachmentId: bigint) => string> = [];
	if ((params.attachment.flags & ForkMessageAttachmentFlags.HAS_COVER) !== 0) copies.push(forkAttachmentCoverKey);
	if (params.attachment.waveform) copies.push(forkAttachmentWaveformKey);
	for (const keyOf of copies) {
		const destinationKey = keyOf(params.destinationChannelId, params.newAttachmentId);
		params.copyKeys.push(destinationKey);
		try {
			await params.storageService.copyObject({
				sourceBucket: Config.s3.buckets.cdn,
				sourceKey: keyOf(params.sourceChannelId, params.attachment.id),
				destinationBucket: Config.s3.buckets.cdn,
				destinationKey,
			});
		} catch (error) {
			if (!isStorageObjectMissing(error)) throw error;
			Logger.warn({destinationKey}, 'Forwarded audio attachment has nothing to copy here');
		}
	}
}
