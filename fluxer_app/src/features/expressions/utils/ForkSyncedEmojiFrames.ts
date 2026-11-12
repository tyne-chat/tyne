// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the frames of animated custom emoji, for keeping them in step (tyne-chat/tyne#612; the clock
// is ForkSyncedEmojiClock.ts, the drawing ForkSyncedEmojiPlayer.ts, and ForkSyncedEmojiImages.ts
// finds the emoji in the page). A browser starts each image's animation on its own and offers no way
// to pick the frame an <img> shows, so each animated emoji URL is fetched once here and decoded with
// WebCodecs' ImageDecoder into its frames, at the size it is shown.
//
// Requests: one fetch of each animated emoji URL, which the <img> loads anyway (the same URL, from
// the HTTP cache when it is there; the media proxy, not the API, so it does not count towards the
// API's rate limit). Every copy of the emoji shares it, at every size. A URL that fails is not fetched
// again in this session: its emoji stay plain <img>s. Only emoji near the viewport are fetched and
// decoded, and frames nobody shows are dropped after a minute.

import {
	createForkEmojiTimeline,
	type ForkEmojiTimeline,
	forkEmojiFrameDurationMs,
} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import {unwrapDesktopLocalResourceURL} from '@app/features/messaging/utils/DesktopLocalResourceTarget';
import {
	canDecodeAnimatedAvif,
	closeImageDecoder,
	type FluxerImageDecoderConstructor,
	getImageDecoderConstructor,
} from '@app/features/platform/utils/ImageDecoderInterop';

const CUSTOM_EMOJI_PATH = /\/emojis\/\d+\.(?:webp|gif|png|avif)$/;
// Frames are decoded at the size the emoji is shown, rounded up to a multiple of this, so that a
// slightly different size (another zoom level, a reaction next to a message) reuses them.
const FRAME_SIZE_STEP = 16;
// All frames of one emoji at one size stay within this; a very long animation gets smaller frames.
const MAX_DECODED_BYTES = 8 * 1024 * 1024;
const BYTES_PER_PIXEL = 4;
const MAX_FRAMES = 1200;
const UNUSED_FRAMES_KEPT_MS = 60_000;

export interface ForkEmojiFrames {
	readonly frames: ReadonlyArray<ImageBitmap>;
	readonly timeline: ForkEmojiTimeline;
}

export type ForkEmojiFramesState =
	| {readonly status: 'loading'}
	| {readonly status: 'ready'; readonly frames: ForkEmojiFrames}
	| {readonly status: 'failed'};

const LOADING: ForkEmojiFramesState = {status: 'loading'};
const FAILED: ForkEmojiFramesState = {status: 'failed'};

// The emoji's own address. The desktop app reaches a server without https through a local proxy,
// which carries the real address as a parameter; the image and the fetch keep the proxy's address.
function parseEmojiUrl(src: string): URL | null {
	// Nearly every image on the page is something else: tell before parsing.
	if (!src.includes('emojis')) return null;
	let url: URL;
	try {
		url = new URL(src, typeof document === 'undefined' ? undefined : document.baseURI);
		url = new URL(unwrapDesktopLocalResourceURL(url.href));
	} catch {
		return null;
	}
	return CUSTOM_EMOJI_PATH.test(url.pathname) ? url : null;
}

export function isForkSyncableEmojiUrl(src: string): boolean {
	return parseEmojiUrl(src)?.searchParams.get('animated') === 'true';
}

// The frame size to decode for an emoji shown `devicePixels` wide: no larger than the image the URL
// asks the media proxy for.
export function forkEmojiFrameSize(src: string, devicePixels: number): number {
	const wanted = Math.max(FRAME_SIZE_STEP, Math.ceil(devicePixels / FRAME_SIZE_STEP) * FRAME_SIZE_STEP);
	const served = Number(parseEmojiUrl(src)?.searchParams.get('size'));
	return served > 0 ? Math.min(wanted, served) : wanted;
}

export function forkSyncedEmojiSupported(): boolean {
	return (
		getImageDecoderConstructor() !== null &&
		typeof createImageBitmap === 'function' &&
		typeof IntersectionObserver === 'function' &&
		typeof ResizeObserver === 'function' &&
		typeof MutationObserver === 'function' &&
		typeof requestAnimationFrame === 'function' &&
		typeof CSSStyleSheet === 'function' &&
		typeof document !== 'undefined' &&
		Array.isArray(document.adoptedStyleSheets)
	);
}

function closeFrames(frames: ReadonlyArray<ImageBitmap>): void {
	for (const frame of frames) {
		frame.close();
	}
}

async function decodeFrames(
	ImageDecoderConstructor: FluxerImageDecoderConstructor,
	data: ArrayBuffer,
	type: string,
	size: number,
): Promise<ForkEmojiFrames | null> {
	const decoder = new ImageDecoderConstructor({data, type});
	const frames: Array<ImageBitmap> = [];
	try {
		await decoder.tracks.ready;
		await decoder.completed;
		const track = decoder.tracks.selectedTrack;
		// Only endless loops follow a clock; play-once animations and still images stay as they are.
		if (!track || track.frameCount < 2 || track.repetitionCount !== Number.POSITIVE_INFINITY) {
			return null;
		}
		const frameCount = track.frameCount;
		const largestSide = Math.floor(Math.sqrt(MAX_DECODED_BYTES / (BYTES_PER_PIXEL * frameCount)));
		if (frameCount > MAX_FRAMES) {
			return null;
		}
		const frameDurationsMs: Array<number> = [];
		for (let index = 0; index < frameCount; index++) {
			const {image} = await decoder.decode({frameIndex: index});
			try {
				const scale = Math.min(1, Math.min(size, largestSide) / Math.max(image.displayWidth, image.displayHeight));
				frames.push(
					await createImageBitmap(image, {
						resizeWidth: Math.max(1, Math.round(image.displayWidth * scale)),
						resizeHeight: Math.max(1, Math.round(image.displayHeight * scale)),
						resizeQuality: 'high',
					}),
				);
				frameDurationsMs.push(forkEmojiFrameDurationMs(image.duration));
			} finally {
				image.close();
			}
		}
		return {frames, timeline: createForkEmojiTimeline(frameDurationsMs)};
	} catch (error) {
		closeFrames(frames);
		throw error;
	} finally {
		closeImageDecoder(decoder);
	}
}

// An emoji's bytes, fetched once, to decode at each size it is shown.
export interface ForkEmojiSource {
	decode(size: number): Promise<ForkEmojiFrames | null>;
}

export async function loadForkEmojiSource(src: string): Promise<ForkEmojiSource | null> {
	const ImageDecoderConstructor = getImageDecoderConstructor();
	if (!ImageDecoderConstructor || !forkSyncedEmojiSupported()) {
		return null;
	}
	const response = await fetch(src, {cache: 'force-cache'});
	if (!response.ok) {
		return null;
	}
	const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!type.startsWith('image/') || !(await ImageDecoderConstructor.isTypeSupported(type))) {
		return null;
	}
	// Some builds decode animated AVIF without its transparency; upstream has a probe for that.
	if (type === 'image/avif' && !(await canDecodeAnimatedAvif())) {
		return null;
	}
	const data = await response.arrayBuffer();
	return {decode: (size) => decodeFrames(ImageDecoderConstructor, data, type, size)};
}

interface FramesEntry {
	state: ForkEmojiFramesState;
	users: number;
	releaseTimer: ReturnType<typeof setTimeout> | null;
}

interface SourceEntry {
	source: Promise<ForkEmojiSource | null>;
	failed: boolean;
	sizes: Map<number, FramesEntry>;
}

export class ForkEmojiFramesStore {
	private readonly sources = new Map<string, SourceEntry>();
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly load: (src: string) => Promise<ForkEmojiSource | null> = loadForkEmojiSource,
		private readonly keepUnusedMs = UNUSED_FRAMES_KEPT_MS,
	) {}

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	// While frames of this size are still being decoded (after a zoom), or could not be made, the
	// answer is the frames of another size, if there are any: they are drawn scaled.
	peek(src: string, size: number): ForkEmojiFramesState | null {
		const source = this.sources.get(src);
		if (!source) return null;
		if (source.failed) return FAILED;
		const entry = source.sizes.get(size);
		if (entry && entry.state.status !== 'ready') {
			for (const other of source.sizes.values()) {
				if (other.state.status === 'ready') return other.state;
			}
		}
		return entry?.state ?? null;
	}

	acquire(src: string, size: number): () => void {
		let source = this.sources.get(src);
		if (!source) {
			source = {source: this.load(src).catch(() => null), failed: false, sizes: new Map()};
			this.sources.set(src, source);
		}
		// A failed URL stays failed for the session, so it is not fetched again.
		if (source.failed) {
			return () => {};
		}
		let entry = source.sizes.get(size);
		if (entry) {
			entry.users += 1;
			if (entry.releaseTimer !== null) {
				clearTimeout(entry.releaseTimer);
				entry.releaseTimer = null;
			}
		} else {
			entry = {state: LOADING, users: 1, releaseTimer: null};
			source.sizes.set(size, entry);
			this.startDecode(src, source, size, entry);
		}
		const acquired = entry;
		const acquiredFrom = source;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			acquired.users -= 1;
			this.scheduleRelease(src, acquiredFrom, size, acquired);
		};
	}

	private startDecode(src: string, source: SourceEntry, size: number, entry: FramesEntry): void {
		source.source
			.then((loaded) => (loaded ? loaded.decode(size).catch(() => 'no frames at this size' as const) : null))
			.catch(() => null)
			.then((frames) => {
				if (frames === 'no frames at this size') {
					// Decoding broke off (too little memory for frames this large, say). The emoji itself is
					// fine, and so are its frames at other sizes; this size is not tried again.
					entry.state = FAILED;
					this.notify();
					return;
				}
				if (frames) {
					entry.state = {status: 'ready', frames};
					this.scheduleRelease(src, source, size, entry);
					this.notify();
					return;
				}
				// Nothing to fetch, or not an endless animation: forget the bytes and every size.
				source.failed = true;
				source.source = Promise.resolve(null);
				const dropped = [...source.sizes.values()];
				source.sizes.clear();
				this.notify();
				for (const other of dropped) {
					if (other.releaseTimer !== null) clearTimeout(other.releaseTimer);
					if (other.state.status === 'ready') closeFrames(other.state.frames.frames);
				}
			});
	}

	private scheduleRelease(src: string, source: SourceEntry, size: number, entry: FramesEntry): void {
		if (entry.users > 0 || entry.state.status !== 'ready' || entry.releaseTimer !== null) {
			return;
		}
		const {frames} = entry.state.frames;
		entry.releaseTimer = setTimeout(() => {
			entry.releaseTimer = null;
			if (entry.users > 0 || source.sizes.get(size) !== entry) return;
			source.sizes.delete(size);
			if (source.sizes.size === 0 && this.sources.get(src) === source) {
				this.sources.delete(src);
			}
			// Whoever still draws these frames lets go of them when told, before they are closed.
			this.notify();
			closeFrames(frames);
		}, this.keepUnusedMs);
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

export const forkEmojiFrames = new ForkEmojiFramesStore();
