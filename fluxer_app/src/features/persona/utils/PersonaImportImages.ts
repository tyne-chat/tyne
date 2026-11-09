// SPDX-License-Identifier: AGPL-3.0-or-later

// Storing the pictures of an import (tyne-chat/tyne#243): every member's, before the review, so the
// review compares stored pictures by hash and shows them (tyne-chat/tyne#567). A picture comes from
// the export's zip, from this account's own copy on this instance, or from a download by the server;
// a link in the file is never stored or shown.

import i18n from '@app/app/I18n';
import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import type {ReviewMember, StoredPictures} from '@app/features/persona/utils/PersonaImportReview';
import SessionManager from '@app/features/platform/state/AuthSession';
import {withoutTrailingSlashes} from '@app/features/platform/transport/RestTransport';
import {
	imageFileExtension,
	ownTyneMediaImageHash,
	type PersonaImageKind,
} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import {msg} from '@lingui/core/macro';

const IMPORT_NETWORK_ERROR_DESCRIPTOR = msg({
	message: 'Network error',
	comment: 'Why an image could not be imported when the request to the server failed',
});
const IMPORT_HTTP_ERROR_DESCRIPTOR = msg({
	message: 'Request failed (HTTP {status})',
	comment: 'Why an image could not be imported when the server answered with HTTP status {status}',
});
const IMPORT_UNKNOWN_ERROR_DESCRIPTOR = msg({
	message: 'Unknown error',
	comment: 'Why an image could not be imported when no reason is known',
});

type StoredImage = {hash: string; avatarColor: number | null};

interface BatchImportResult {
	avatar_hash?: string;
	avatar_color?: number | null;
	banner_hash?: string;
	error?: string;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	jxl: 'image/jxl',
	svg: 'image/svg+xml',
};

// The batch answers with a progress stream, which the REST client cannot read, so it is fetched
// directly. Its URL is built as the REST client builds one (`resolveUrl` in RestTransport.ts), so on
// desktop it takes the instance's own local route, not `/api/v1`, which the desktop proxy reads as
// an instance named "v1" (tyne-chat/tyne#360).
export function personaImportBatchURL(): string {
	const base = withoutTrailingSlashes(RuntimeConfig.transportApiEndpoint);
	return `${base}/v${RuntimeConfig.apiCodeVersion}${ForkEndpoints.USER_PERSONA_IMPORT_BATCH_AVATARS}`;
}

// Asks the server to fetch remote images (avatars or banners) in batches, and reads its NDJSON
// progress stream. Returns what was stored and what failed, by URL.
async function fetchRemoteImages(
	urls: ReadonlyArray<string>,
	kind: PersonaImageKind,
	onProgress: (completed: number) => void,
): Promise<{stored: Map<string, StoredImage>; errors: Map<string, string>}> {
	const stored = new Map<string, StoredImage>();
	const errors = new Map<string, string>();
	const record = (url: string, result: BatchImportResult) => {
		const hash = kind === 'avatar' ? result.avatar_hash : result.banner_hash;
		if (hash)
			stored.set(url, {hash, avatarColor: typeof result.avatar_color === 'number' ? result.avatar_color : null});
		if (result.error) errors.set(url, result.error);
	};
	const BATCH_LIMIT = 500;
	for (let start = 0; start < urls.length; start += BATCH_LIMIT) {
		const batch = urls.slice(start, start + BATCH_LIMIT);
		const handleLine = (line: string) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			let event: {type?: string; url?: string; completed?: number; results?: Record<string, BatchImportResult>};
			try {
				event = JSON.parse(trimmed);
			} catch {
				return;
			}
			if (event.type === 'progress') {
				if (event.url) record(event.url, event as BatchImportResult);
				if (typeof event.completed === 'number') onProgress(start + event.completed);
			} else if (event.type === 'complete' && event.results) {
				for (const [url, result] of Object.entries(event.results)) record(url, result);
			}
		};
		try {
			const res = await fetch(personaImportBatchURL(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(SessionManager.token ? {Authorization: SessionManager.token} : {}),
				},
				body: JSON.stringify({urls: batch, kind}),
			});
			if (!res.ok) {
				let errorMessage = i18n._(IMPORT_HTTP_ERROR_DESCRIPTOR, {status: res.status});
				try {
					const errorJson = await res.json();
					if (errorJson.message) errorMessage = errorJson.message;
				} catch {}
				for (const url of batch) errors.set(url, errorMessage);
				continue;
			}
			const reader = res.body?.getReader();
			if (!reader) continue;
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const {done, value} = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, {stream: true});
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) handleLine(line);
			}
			buffer += decoder.decode();
			for (const line of buffer.split('\n')) handleLine(line);
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : i18n._(IMPORT_NETWORK_ERROR_DESCRIPTOR);
			for (const url of batch) errors.set(url, errorMsg);
		}
	}
	return {stored, errors};
}

export function imageDataUri(bytes: Uint8Array): string {
	const type = IMAGE_MIME_TYPES[imageFileExtension(bytes)] ?? 'application/octet-stream';
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return `data:${type};base64,${btoa(binary)}`;
}

/** Runs `task` on each item, a few at a time. */
async function forEachLimited<T>(items: ReadonlyArray<T>, limit: number, task: (item: T) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next++] as T;
			await task(item);
		}
	};
	await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
}

/** The picture bytes a Tyne export's zip holds for a member, if any. */
export function bundlePictureBytes(
	source: PersonaImportSource,
	member: ReviewMember,
	kind: PersonaImageKind,
): Uint8Array | undefined {
	if (source.kind !== 'bundle') return undefined;
	const path = member.extras?.[kind];
	return path ? source.images.get(path) : undefined;
}

export interface PictureProgress {
	done: number;
	total: number;
	phase: 'zip' | 'avatar' | 'banner';
}

/** What storing a file's pictures gave each member, and why a picture failed (keyed `index:kind`). */
export interface StoredFilePictures {
	stored: Map<number, StoredPictures>;
	failures: Map<string, string>;
}

/**
 * Stores the pictures asked for, at most four zip uploads at a time and one streamed download
 * request per 500 links; a failure is not retried. Returns what each member got, with the reasons for
 * failures.
 */
export async function storeMemberPictures(
	source: PersonaImportSource,
	members: ReadonlyArray<ReviewMember>,
	needed: ReadonlyMap<number, {avatar: boolean; banner: boolean}>,
	ownUserId: string | null,
	mediaEndpoint: string | null,
	onProgress: (progress: PictureProgress) => void,
): Promise<StoredFilePictures> {
	const images = new Map<string, StoredImage>();
	const failures = new Map<string, string>();
	const uploads: Array<{key: string; kind: PersonaImageKind; bytes: Uint8Array}> = [];
	const remote: Record<PersonaImageKind, Map<string, Array<string>>> = {avatar: new Map(), banner: new Map()};
	for (const [index, want] of needed) {
		const member = members[index];
		if (!member) continue;
		for (const kind of ['avatar', 'banner'] as const) {
			if (!want[kind]) continue;
			const key = `${index}:${kind}`;
			const bytes = bundlePictureBytes(source, member, kind);
			if (bytes) {
				uploads.push({key, kind, bytes});
				continue;
			}
			const url = kind === 'avatar' ? member.member.avatarUrl : member.member.bannerUrl;
			if (!url) continue;
			const own = ownUserId && mediaEndpoint ? ownTyneMediaImageHash(url, mediaEndpoint, kind, ownUserId) : null;
			if (own) images.set(key, {hash: own, avatarColor: null});
			else if (url.startsWith('http://') || url.startsWith('https://')) {
				remote[kind].set(url, [...(remote[kind].get(url) ?? []), key]);
			} else {
				failures.set(key, i18n._(IMPORT_UNKNOWN_ERROR_DESCRIPTOR));
			}
		}
	}

	if (uploads.length > 0) {
		let done = 0;
		onProgress({done, total: uploads.length, phase: 'zip'});
		await forEachLimited(uploads, 4, async (upload) => {
			try {
				images.set(upload.key, await PersonaCommands.importPersonaImage(upload.kind, imageDataUri(upload.bytes)));
			} catch (err: unknown) {
				const unknownError = i18n._(IMPORT_UNKNOWN_ERROR_DESCRIPTOR);
				failures.set(upload.key, PersonaCommands.personaErrorMessage(err, unknownError) ?? unknownError);
			}
			done++;
			onProgress({done, total: uploads.length, phase: 'zip'});
		});
	}

	for (const kind of ['avatar', 'banner'] as const) {
		const urls = Array.from(remote[kind].keys());
		if (urls.length === 0) continue;
		onProgress({done: 0, total: urls.length, phase: kind});
		const fetched = await fetchRemoteImages(urls, kind, (completed) =>
			onProgress({done: completed, total: urls.length, phase: kind}),
		);
		for (const [url, keys] of remote[kind]) {
			const image = fetched.stored.get(url);
			for (const key of keys) {
				if (image) images.set(key, image);
				else failures.set(key, fetched.errors.get(url) ?? i18n._(IMPORT_UNKNOWN_ERROR_DESCRIPTOR));
			}
		}
	}

	const stored = new Map<number, StoredPictures>();
	for (const index of needed.keys()) {
		const avatar = images.get(`${index}:avatar`) ?? null;
		const banner = images.get(`${index}:banner`) ?? null;
		stored.set(index, {
			images: {avatar, banner: banner ? {hash: banner.hash} : null},
			avatarFailed: failures.has(`${index}:avatar`),
			bannerFailed: failures.has(`${index}:banner`),
		});
	}
	return {stored, failures};
}

/**
 * Stores a Tyne export's tag icon: the zip's file, this account's own copy here, or a copy the server
 * downloads. The settings take only the stored hash, never a link.
 */
export async function storeTagIcon(
	source: PersonaImportSource,
	ownUserId: string | null,
	mediaEndpoint: string | null,
): Promise<{hash: string | undefined; error: string | null}> {
	if (source.kind !== 'bundle') return {hash: undefined, error: null};
	const bytes = source.manifest.tag_icon ? source.images.get(source.manifest.tag_icon) : undefined;
	const url = source.manifest.tag_icon_url;
	try {
		if (bytes)
			return {hash: (await PersonaCommands.importPersonaImage('avatar', imageDataUri(bytes))).hash, error: null};
	} catch (err: unknown) {
		const unknownError = i18n._(IMPORT_UNKNOWN_ERROR_DESCRIPTOR);
		return {hash: undefined, error: PersonaCommands.personaErrorMessage(err, unknownError) ?? unknownError};
	}
	if (!url) return {hash: undefined, error: null};
	const own = ownUserId && mediaEndpoint ? ownTyneMediaImageHash(url, mediaEndpoint, 'avatar', ownUserId) : null;
	if (own) return {hash: own, error: null};
	if (!url.startsWith('http://') && !url.startsWith('https://')) return {hash: undefined, error: null};
	const fetched = await fetchRemoteImages([url], 'avatar', () => {});
	const hash = fetched.stored.get(url)?.hash;
	return hash
		? {hash, error: null}
		: {hash: undefined, error: fetched.errors.get(url) ?? i18n._(IMPORT_UNKNOWN_ERROR_DESCRIPTOR)};
}
