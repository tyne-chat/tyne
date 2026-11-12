// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: plays animated custom emoji on the clocks of ForkSyncedEmojiClock.ts (tyne-chat/tyne#612).
// A browser starts each image's animation on its own and offers no way to pick the frame an <img>
// shows, so two wings loaded a moment apart (an edit, a second reaction) flap out of step until the
// page is reloaded. Here each animated emoji URL is fetched once and decoded with WebCodecs'
// ImageDecoder into a strip of its frames, side by side; ForkEmojiImg keeps upstream's <img>
// and shows the strip in it, and the player below moves the strip (object-position) to the frame the
// clock gives. Without ImageDecoder, or when anything fails, the <img> is left as upstream has it.
//
// Requests: one fetch of each animated emoji URL, which the <img> loads anyway (the same URL, from
// the HTTP cache when it is there; the media proxy, not the API, so it does not count towards the
// API's rate limit). Every copy of the emoji shares it. A URL that fails is not fetched again in this
// session: its emoji stay plain <img>s. Only emoji near the viewport are fetched and decoded, and a
// strip nobody shows is dropped after a minute.

import {
	createForkEmojiTimeline,
	type ForkEmojiTimeline,
	ForkSyncedEmojiClocks,
	forkEmojiFrameAt,
	forkEmojiFrameDurationMs,
} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import {
	closeImageDecoder,
	type FluxerImageDecoderConstructor,
	getImageDecoderConstructor,
} from '@app/features/platform/utils/ImageDecoderInterop';

const ANIMATED_EMOJI_PATH = /\/emojis\/\d+\.(?:webp|gif|png|avif)$/;
// A canvas or image this wide is still safe in every engine; strips of long emoji are scaled down.
const MAX_STRIP_WIDTH = 16384;
const MIN_FRAME_SIZE = 24;
// Space between frames, so that rounding at the frame's edge shows nothing rather than its neighbour.
const FRAME_GAP_RATIO = 0.125;
const UNUSED_STRIP_KEPT_MS = 60_000;
// Emoji this close to the viewport count as on screen. `scrollMargin` extends the message list's own
// scroll box too (Chromium); other engines ignore it.
const NEAR_VIEWPORT = {rootMargin: '200px', scrollMargin: '200px'} as IntersectionObserverInit;

export interface ForkEmojiStrip {
	readonly url: string;
	readonly frameCount: number;
	readonly timeline: ForkEmojiTimeline;
}

export type ForkEmojiStripState =
	| {readonly status: 'loading'}
	| {readonly status: 'ready'; readonly strip: ForkEmojiStrip}
	| {readonly status: 'failed'};

const LOADING: ForkEmojiStripState = {status: 'loading'};
const FAILED: ForkEmojiStripState = {status: 'failed'};

export function forkEmojiStripPosition(frame: number, frameCount: number): string {
	return `${frameCount > 1 ? (frame * 100) / (frameCount - 1) : 0}% 50%`;
}

export function isForkSyncableEmojiUrl(src: string): boolean {
	let url: URL;
	try {
		url = new URL(src, typeof document === 'undefined' ? undefined : document.baseURI);
	} catch {
		return false;
	}
	return url.searchParams.get('animated') === 'true' && ANIMATED_EMOJI_PATH.test(url.pathname);
}

export function forkSyncedEmojiSupported(): boolean {
	return (
		getImageDecoderConstructor() !== null &&
		typeof OffscreenCanvas === 'function' &&
		typeof IntersectionObserver === 'function' &&
		typeof requestAnimationFrame === 'function' &&
		typeof URL.createObjectURL === 'function'
	);
}

async function decodeStripCanvas(
	ImageDecoderConstructor: FluxerImageDecoderConstructor,
	data: ArrayBuffer,
	type: string,
): Promise<{canvas: OffscreenCanvas; frameDurationsMs: Array<number>} | null> {
	const decoder = new ImageDecoderConstructor({data, type});
	try {
		await decoder.tracks.ready;
		await decoder.completed;
		const track = decoder.tracks.selectedTrack;
		// Only endless loops follow a clock; play-once animations and still images stay as they are.
		if (!track || track.frameCount < 2 || track.repetitionCount !== Number.POSITIVE_INFINITY) {
			return null;
		}
		const frameCount = track.frameCount;
		const frameDurationsMs: Array<number> = [];
		let canvas: OffscreenCanvas | null = null;
		let context: OffscreenCanvasRenderingContext2D | null = null;
		let cell = 0;
		let gap = 0;
		for (let index = 0; index < frameCount; index++) {
			const {image} = await decoder.decode({frameIndex: index});
			try {
				const width = image.displayWidth;
				const height = image.displayHeight;
				if (!canvas) {
					const size = Math.max(width, height);
					cell = Math.min(size, Math.floor(MAX_STRIP_WIDTH / (frameCount * (1 + FRAME_GAP_RATIO))));
					if (cell < MIN_FRAME_SIZE) {
						return null;
					}
					gap = Math.ceil(cell * FRAME_GAP_RATIO);
					canvas = new OffscreenCanvas(frameCount * cell + (frameCount - 1) * gap, cell);
					context = canvas.getContext('2d');
					if (!context) {
						return null;
					}
					context.imageSmoothingQuality = 'high';
				}
				// Each frame is fitted into a square cell, as `object-fit: contain` shows it in the emoji's box.
				const scale = cell / Math.max(width, height);
				const drawnWidth = width * scale;
				const drawnHeight = height * scale;
				context!.drawImage(
					image as VideoFrame & CanvasImageSource,
					index * (cell + gap) + (cell - drawnWidth) / 2,
					(cell - drawnHeight) / 2,
					drawnWidth,
					drawnHeight,
				);
				frameDurationsMs.push(forkEmojiFrameDurationMs(image.duration));
			} finally {
				image.close();
			}
		}
		return canvas ? {canvas, frameDurationsMs} : null;
	} finally {
		closeImageDecoder(decoder);
	}
}

interface LoadedStrip {
	strip: ForkEmojiStrip;
	// Holds the decoded strip in the image cache while the strip is in use.
	preloaded: HTMLImageElement;
}

export async function loadForkEmojiStrip(src: string): Promise<LoadedStrip | null> {
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
	const decoded = await decodeStripCanvas(ImageDecoderConstructor, await response.arrayBuffer(), type);
	if (!decoded) {
		return null;
	}
	const blob = await decoded.canvas.convertToBlob({type: 'image/png'});
	const url = URL.createObjectURL(blob);
	const preloaded = new Image();
	preloaded.src = url;
	try {
		await preloaded.decode();
	} catch {
		URL.revokeObjectURL(url);
		return null;
	}
	const frameCount = decoded.frameDurationsMs.length;
	return {strip: {url, frameCount, timeline: createForkEmojiTimeline(decoded.frameDurationsMs)}, preloaded};
}

interface StripEntry {
	state: ForkEmojiStripState;
	loaded: LoadedStrip | null;
	users: number;
	releaseTimer: ReturnType<typeof setTimeout> | null;
}

export class ForkEmojiStripStore {
	private readonly entries = new Map<string, StripEntry>();
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly load: (src: string) => Promise<LoadedStrip | null> = loadForkEmojiStrip,
		private readonly keepUnusedMs = UNUSED_STRIP_KEPT_MS,
	) {}

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	peek(src: string): ForkEmojiStripState | null {
		return this.entries.get(src)?.state ?? null;
	}

	acquire(src: string): () => void {
		let entry = this.entries.get(src);
		if (entry) {
			entry.users += 1;
			if (entry.releaseTimer !== null) {
				clearTimeout(entry.releaseTimer);
				entry.releaseTimer = null;
			}
		} else {
			entry = {state: LOADING, loaded: null, users: 1, releaseTimer: null};
			this.entries.set(src, entry);
			this.startLoad(src, entry);
		}
		const acquired = entry;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			acquired.users -= 1;
			this.scheduleRelease(src, acquired);
		};
	}

	private startLoad(src: string, entry: StripEntry): void {
		this.load(src)
			.catch(() => null)
			.then((loaded) => {
				if (this.entries.get(src) !== entry) {
					if (loaded) URL.revokeObjectURL(loaded.strip.url);
					return;
				}
				entry.loaded = loaded;
				entry.state = loaded ? {status: 'ready', strip: loaded.strip} : FAILED;
				this.scheduleRelease(src, entry);
				this.notify();
			});
	}

	private scheduleRelease(src: string, entry: StripEntry): void {
		// A failed URL stays failed for the session, so it is not fetched again.
		if (entry.users > 0 || entry.state.status !== 'ready' || entry.releaseTimer !== null) {
			return;
		}
		entry.releaseTimer = setTimeout(() => {
			entry.releaseTimer = null;
			if (entry.users > 0 || this.entries.get(src) !== entry) return;
			this.entries.delete(src);
			if (entry.loaded) URL.revokeObjectURL(entry.loaded.strip.url);
			this.notify();
		}, this.keepUnusedMs);
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

interface PlayerInstance {
	readonly img: HTMLImageElement;
	readonly strip: ForkEmojiStrip;
	frame: number;
	shown: boolean;
}

export interface ForkSyncedEmojiPlayerEnvironment {
	now(): number;
	requestFrame(callback: (now: number) => void): number;
	cancelFrame(handle: number): void;
	observe(callback: IntersectionObserverCallback): Pick<IntersectionObserver, 'observe' | 'unobserve'>;
}

const BROWSER_ENVIRONMENT: ForkSyncedEmojiPlayerEnvironment = {
	now: () => performance.now(),
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (handle) => cancelAnimationFrame(handle),
	observe: (callback) => new IntersectionObserver(callback, NEAR_VIEWPORT),
};

export class ForkSyncedEmojiPlayer {
	private readonly instances = new Map<Element, PlayerInstance>();
	private readonly clocks = new ForkSyncedEmojiClocks();
	private observer: Pick<IntersectionObserver, 'observe' | 'unobserve'> | null = null;
	private frameHandle: number | null = null;

	constructor(private readonly environment: ForkSyncedEmojiPlayerEnvironment = BROWSER_ENVIRONMENT) {}

	// An emoji counts as shown from the moment it is attached until it is detached or found outside the
	// viewport, so that one replacing another in the same render does not restart the clock.
	attach(img: HTMLImageElement, strip: ForkEmojiStrip): () => void {
		const instance: PlayerInstance = {img, strip, frame: -1, shown: true};
		this.instances.set(img, instance);
		this.clocks.show(strip.timeline.loopKey);
		this.draw(instance, this.environment.now());
		this.observer ??= this.environment.observe(this.handleIntersections);
		this.observer.observe(img);
		this.scheduleFrame();
		return () => {
			if (this.instances.get(img) !== instance) return;
			this.instances.delete(img);
			this.observer?.unobserve(img);
			if (instance.shown) {
				this.clocks.hide(strip.timeline.loopKey);
			}
			img.style.removeProperty('object-position');
			this.scheduleFrame();
		};
	}

	private readonly handleIntersections = (entries: Array<IntersectionObserverEntry>): void => {
		const now = this.environment.now();
		for (const entry of entries) {
			const instance = this.instances.get(entry.target);
			if (!instance || instance.shown === entry.isIntersecting) continue;
			instance.shown = entry.isIntersecting;
			if (instance.shown) {
				this.clocks.show(instance.strip.timeline.loopKey);
				this.draw(instance, now);
			} else {
				this.clocks.hide(instance.strip.timeline.loopKey);
			}
		}
		this.scheduleFrame();
	};

	private draw(instance: PlayerInstance, now: number): void {
		const {timeline, frameCount} = instance.strip;
		const frame = forkEmojiFrameAt(timeline, this.clocks.elapsedAt(timeline.loopKey, now));
		if (frame === instance.frame) return;
		instance.frame = frame;
		instance.img.style.setProperty('object-position', forkEmojiStripPosition(frame, frameCount));
	}

	private scheduleFrame(): void {
		if (this.frameHandle === null) {
			this.frameHandle = this.environment.requestFrame(this.tick);
		}
	}

	private readonly tick = (now: number): void => {
		this.frameHandle = null;
		let anyShown = false;
		for (const instance of this.instances.values()) {
			if (!instance.shown) continue;
			anyShown = true;
			this.draw(instance, now);
		}
		this.clocks.endOfFrame();
		if (anyShown) {
			this.scheduleFrame();
		}
	};
}

// Frames are decoded only for emoji near the viewport: the message list keeps the whole loaded
// history mounted, and each strip holds all of its emoji's frames.
export class ForkEmojiNearViewport {
	private observer: Pick<IntersectionObserver, 'observe' | 'unobserve'> | null = null;
	private readonly listeners = new Map<Element, (near: boolean) => void>();

	constructor(
		private readonly createObserver: ForkSyncedEmojiPlayerEnvironment['observe'] = BROWSER_ENVIRONMENT.observe,
	) {}

	observe(element: Element, listener: (near: boolean) => void): () => void {
		this.observer ??= this.createObserver((entries) => {
			for (const entry of entries) {
				this.listeners.get(entry.target)?.(entry.isIntersecting);
			}
		});
		this.listeners.set(element, listener);
		this.observer.observe(element);
		return () => {
			if (this.listeners.get(element) !== listener) return;
			this.listeners.delete(element);
			this.observer?.unobserve(element);
		};
	}
}

export const forkEmojiStrips = new ForkEmojiStripStore();
export const forkEmojiNearViewport = new ForkEmojiNearViewport();
export const forkSyncedEmojiPlayer = new ForkSyncedEmojiPlayer();
