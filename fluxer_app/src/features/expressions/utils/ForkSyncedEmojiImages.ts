// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: finds the animated custom emoji in the page and keeps them in step (tyne-chat/tyne#612),
// wherever upstream shows one: a message, a reaction, the emoji picker, the composer, a tooltip.
// Nothing in upstream's components changes for it. Every <img> tells the document when it has
// loaded; one that had loaded before it was put into the page (React builds a part of the page
// before attaching it, and an image from the cache can be done by then) is found when it arrives.
// An image whose address is an animated custom emoji is watched from then on, and while it is near
// the viewport its frames are fetched (ForkSyncedEmojiFrames.ts) and drawn on a canvas next to it
// (ForkSyncedEmojiPlayer.ts). It is let go as soon as its address changes (an emoji that stops
// animating when the pointer leaves, a picker cell reused for another emoji) or it leaves the page.
//
// The canvas is the one thing put into upstream's (React's) part of the page. React keeps to the
// nodes it made, so a node it does not know stays where it is; when upstream removes the image, the
// canvas is taken away with it before the page is painted again. Where something else removes the
// canvas (an editor that tolerates no foreign nodes), that image is left alone from then on.
//
// Requests: none of its own; see ForkSyncedEmojiFrames.ts.

import {
	type ForkEmojiFrames,
	type ForkEmojiFramesStore,
	forkEmojiFrameSize,
	forkEmojiFrames,
	forkSyncedEmojiSupported,
	isForkSyncableEmojiUrl,
} from '@app/features/expressions/utils/ForkSyncedEmojiFrames';
import {
	type ForkShownEmoji,
	type ForkSyncedEmojiPlayer,
	forkSyncedEmojiPlayer,
} from '@app/features/expressions/utils/ForkSyncedEmojiPlayer';

// Emoji this close to the viewport count as on screen. `scrollMargin` extends the message list's own
// scroll box too (Chromium); other engines ignore it. px-ok: a distance in screen pixels.
const NEAR_VIEWPORT = {rootMargin: '200px', scrollMargin: '200px'} as IntersectionObserverInit;

type ViewportListener = (near: boolean, cssPixels: number) => void;

// Frames are decoded only for emoji near the viewport: the message list keeps the whole loaded
// history mounted. The listener also hears how large the emoji is, in CSS pixels. Images are held
// weakly: one that leaves the page far from the viewport is never heard of again.
export class ForkEmojiNearViewport {
	private observer: Pick<IntersectionObserver, 'observe' | 'unobserve'> | null = null;
	private readonly listeners = new WeakMap<Element, ViewportListener>();

	constructor(
		private readonly createObserver: (
			callback: IntersectionObserverCallback,
		) => Pick<IntersectionObserver, 'observe' | 'unobserve'> = (callback) =>
			new IntersectionObserver(callback, NEAR_VIEWPORT),
	) {}

	observe(element: Element, listener: ViewportListener): () => void {
		this.observer ??= this.createObserver((entries) => {
			for (const entry of entries) {
				const {width, height} = entry.boundingClientRect;
				this.listeners.get(entry.target)?.(entry.isIntersecting, Math.max(width, height));
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

interface WatchedImage {
	readonly src: string;
	// The `src` attribute as upstream wrote it, to tell when it writes another.
	readonly attribute: string | null;
	readonly stopWatchingViewport: () => void;
	// How large the emoji is shown, in device pixels, while it is near the viewport.
	shownPixels: number | null;
	size: number | null;
	release: (() => void) | null;
	frames: ForkEmojiFrames | null;
	shown: ForkShownEmoji | null;
}

export interface ForkSyncedEmojiImagesEnvironment {
	observeMutations(callback: MutationCallback): Pick<MutationObserver, 'observe' | 'disconnect'>;
	devicePixelRatio(): number;
}

const BROWSER_ENVIRONMENT: ForkSyncedEmojiImagesEnvironment = {
	observeMutations: (callback) => new MutationObserver(callback),
	devicePixelRatio: () => window.devicePixelRatio || 1,
};

function imageAddress(img: HTMLImageElement): string {
	return img.currentSrc || img.getAttribute('src') || '';
}

export class ForkSyncedEmojiImages {
	// Every animated emoji image that has loaded and is still in the page, as far as is known.
	private readonly watched = new WeakMap<HTMLImageElement, WatchedImage>();
	// Those near the viewport: the only ones that take part in anything.
	private readonly near = new Set<HTMLImageElement>();
	// Images whose canvas somebody else took out of the page.
	private readonly refused = new WeakSet<HTMLImageElement>();
	private mutations: Pick<MutationObserver, 'observe' | 'disconnect'> | null = null;

	constructor(
		private readonly frames: ForkEmojiFramesStore = forkEmojiFrames,
		private readonly player: ForkSyncedEmojiPlayer = forkSyncedEmojiPlayer,
		private readonly viewport: ForkEmojiNearViewport = new ForkEmojiNearViewport(),
		private readonly environment: ForkSyncedEmojiImagesEnvironment = BROWSER_ENVIRONMENT,
	) {}

	install(target: Document): () => void {
		const handleLoad = (event: Event): void => {
			if (event.target instanceof HTMLImageElement) this.imageLoaded(event.target);
		};
		target.addEventListener('load', handleLoad, true);
		const unsubscribe = this.frames.subscribe(this.handleFrames);
		const mutations = this.environment.observeMutations(this.handleMutations);
		this.mutations = mutations;
		// Everything put into or taken out of the page, anywhere: images arriving already loaded, and
		// images leaving with a canvas next to them.
		mutations.observe(target.documentElement, {childList: true, subtree: true});
		return () => {
			target.removeEventListener('load', handleLoad, true);
			unsubscribe();
			mutations.disconnect();
			if (this.mutations === mutations) this.mutations = null;
			for (const img of [...this.near]) this.forget(img);
		};
	}

	// An image put into the page: if it has loaded already, no `load` event will reach the document.
	private imageArrived(img: HTMLImageElement): void {
		if (img.complete && img.naturalWidth > 0) this.imageLoaded(img);
	}

	imageLoaded(img: HTMLImageElement): void {
		const src = imageAddress(img);
		const watched = this.watched.get(img);
		if (watched?.src === src) return;
		if (watched) this.forget(img);
		if (!isForkSyncableEmojiUrl(src) || this.refused.has(img)) return;
		const stopWatchingViewport = this.viewport.observe(img, (near, cssPixels) => {
			this.imageSeen(img, near ? cssPixels * this.environment.devicePixelRatio() : null);
		});
		this.watched.set(img, {
			src,
			attribute: img.getAttribute('src'),
			stopWatchingViewport,
			shownPixels: null,
			size: null,
			release: null,
			frames: null,
			shown: null,
		});
		this.mutations?.observe(img, {attributes: true, attributeFilter: ['src', 'srcset', 'class', 'style']});
	}

	private imageSeen(img: HTMLImageElement, shownPixels: number | null): void {
		const watched = this.watched.get(img);
		if (!watched) return;
		if (!img.isConnected) {
			this.forget(img);
			return;
		}
		watched.shownPixels = shownPixels;
		if (shownPixels === null) {
			this.near.delete(img);
		} else {
			this.near.add(img);
		}
		this.update(img, watched);
	}

	// Brings what is fetched and shown for an image in line with where it is and what has arrived.
	private update(img: HTMLImageElement, watched: WatchedImage): void {
		const size = watched.shownPixels === null ? null : forkEmojiFrameSize(watched.src, watched.shownPixels);
		if (size !== watched.size) {
			const release = watched.release;
			watched.release = size === null ? null : this.frames.acquire(watched.src, size);
			watched.size = size;
			release?.();
		}
		const state = size === null ? null : this.frames.peek(watched.src, size);
		const frames = state?.status === 'ready' ? state.frames : null;
		if (frames === watched.frames) return;
		watched.shown?.hide();
		watched.frames = frames;
		watched.shown = frames
			? this.player.show(img, frames, {
					onDevicePixels: (devicePixels) => {
						if (watched.shownPixels !== null && this.watched.get(img) === watched) {
							watched.shownPixels = devicePixels;
							this.update(img, watched);
						}
					},
					onLost: () => {
						if (this.watched.get(img) === watched) this.refuse(img);
					},
				})
			: null;
	}

	// Leaves an image to upstream for as long as it is in the page.
	private refuse(img: HTMLImageElement): void {
		this.refused.add(img);
		this.forget(img);
	}

	private forget(img: HTMLImageElement): void {
		const watched = this.watched.get(img);
		if (!watched) return;
		this.watched.delete(img);
		this.near.delete(img);
		watched.stopWatchingViewport();
		watched.shown?.hide();
		watched.release?.();
	}

	private readonly handleFrames = (): void => {
		for (const img of [...this.near]) {
			const watched = this.watched.get(img);
			if (watched) this.update(img, watched);
		}
	};

	private readonly handleMutations = (records: Array<MutationRecord>): void => {
		let childrenChanged = false;
		for (const record of records) {
			if (record.type === 'childList') {
				childrenChanged = true;
				for (const node of record.addedNodes) {
					if (node instanceof HTMLImageElement) {
						this.imageArrived(node);
					} else if (node instanceof Element && node.firstElementChild) {
						for (const img of node.getElementsByTagName('img')) this.imageArrived(img);
					}
				}
			} else if (record.target instanceof HTMLImageElement) {
				const img = record.target;
				const watched = this.watched.get(img);
				if (record.attributeName === 'class' || record.attributeName === 'style') {
					watched?.shown?.restyle();
				} else if (watched && (record.attributeName === 'srcset' || img.getAttribute('src') !== watched.attribute)) {
					// Another address: upstream's image shows through again at once, and is looked at anew
					// when it has loaded.
					this.forget(img);
				}
			}
		}
		if (!childrenChanged) return;
		for (const img of [...this.near]) {
			const canvas = this.watched.get(img)?.shown?.canvas;
			if (!img.isConnected) {
				this.forget(img);
			} else if (canvas && !canvas.isConnected) {
				// The image is still there and its canvas is not: whoever owns this part of the page
				// does not want it.
				this.refuse(img);
			} else if (canvas && canvas.parentNode !== img.parentNode) {
				// The image was moved elsewhere: its canvas follows.
				const src = this.watched.get(img)?.src;
				this.forget(img);
				if (src === imageAddress(img)) this.imageLoaded(img);
			}
		}
	};
}

export function installForkSyncedEmoji(target: Document): () => void {
	if (!forkSyncedEmojiSupported()) return () => {};
	return new ForkSyncedEmojiImages().install(target);
}
