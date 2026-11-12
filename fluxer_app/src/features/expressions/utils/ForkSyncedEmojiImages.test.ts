// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {createForkEmojiTimeline} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import {
	type ForkEmojiFrames,
	ForkEmojiFramesStore,
	type ForkEmojiSource,
} from '@app/features/expressions/utils/ForkSyncedEmojiFrames';
import {ForkEmojiNearViewport, ForkSyncedEmojiImages} from '@app/features/expressions/utils/ForkSyncedEmojiImages';
import type {ForkShownEmoji, ForkSyncedEmojiPlayer} from '@app/features/expressions/utils/ForkSyncedEmojiPlayer';
import {afterEach, describe, expect, it, vi} from 'vitest';

const WINGS_L = 'https://media.example/emojis/1553996962712256512.webp?animated=true&size=128';
const WINGS_R = 'https://media.example/emojis/1553996962712256513.webp?animated=true&size=128';
const WINGS_L_STILL = 'https://media.example/emojis/1553996962712256512.webp?size=128';

function makeFrames(): ForkEmojiFrames {
	const frame = () => ({width: 32, height: 32, close: () => {}});
	return {frames: [frame(), frame()] as unknown as Array<ImageBitmap>, timeline: createForkEmojiTimeline([100, 100])};
}

interface Shown {
	img: HTMLImageElement;
	frames: ForkEmojiFrames;
	canvas: HTMLCanvasElement;
	hidden: boolean;
	onDevicePixels: ((devicePixels: number) => void) | undefined;
}

function createHarness({keepUnusedMs}: {keepUnusedMs?: number} = {}) {
	const decode = vi.fn(async (_src: string, _size: number) => makeFrames());
	const load = vi.fn(
		async (src: string): Promise<ForkEmojiSource | null> => ({decode: (size: number) => decode(src, size)}),
	);
	const store = new ForkEmojiFramesStore(load, keepUnusedMs);
	const acquire = vi.spyOn(store, 'acquire');
	const shown: Array<Shown> = [];
	// A player that puts a real canvas after the image, as the real one does, and draws nothing.
	const player = {
		show: vi.fn(
			(
				img: HTMLImageElement,
				frames: ForkEmojiFrames,
				onDevicePixels?: (devicePixels: number) => void,
			): ForkShownEmoji => {
				const canvas = document.createElement('canvas');
				img.after(canvas);
				const entry: Shown = {img, frames, canvas, hidden: false, onDevicePixels};
				shown.push(entry);
				return {
					canvas,
					hide: () => {
						entry.hidden = true;
						canvas.remove();
					},
				};
			},
		),
	} as unknown as ForkSyncedEmojiPlayer;
	let intersections: IntersectionObserverCallback = () => {};
	const viewport = new ForkEmojiNearViewport((callback) => {
		intersections = callback;
		return {observe: () => {}, unobserve: () => {}};
	});
	let mutations: MutationCallback = () => {};
	const observedForMutations: Array<[Node, MutationObserverInit | undefined]> = [];
	const images = new ForkSyncedEmojiImages(store, player, viewport, {
		observeMutations: (callback) => {
			mutations = callback;
			return {
				observe: (target, options) => {
					observedForMutations.push([target, options]);
				},
			};
		},
		devicePixelRatio: () => 2,
	});
	const uninstall = images.install(document);
	const loaded = (img: HTMLImageElement) => {
		img.dispatchEvent(new Event('load'));
	};
	return {
		uninstall,
		loaded,
		load,
		decode,
		acquire,
		shown,
		showing: () => shown.filter((entry) => !entry.hidden),
		observedForMutations,
		// An <img> in the page that has loaded `src`.
		addImage(src: string, parent: HTMLElement = document.body): HTMLImageElement {
			const img = document.createElement('img');
			img.setAttribute('src', src);
			parent.append(img);
			loaded(img);
			return img;
		},
		// The emoji comes near the viewport, 24 CSS pixels large, or leaves it.
		setNear(img: HTMLImageElement, near: boolean) {
			intersections(
				[
					{
						target: img,
						isIntersecting: near,
						boundingClientRect: {width: 24, height: 24},
					} as unknown as IntersectionObserverEntry,
				],
				{} as IntersectionObserver,
			);
		},
		srcChanged(img: HTMLImageElement) {
			mutations([{type: 'attributes', target: img} as unknown as MutationRecord], {} as MutationObserver);
		},
		childrenChanged(parent: Node) {
			mutations([{type: 'childList', target: parent} as unknown as MutationRecord], {} as MutationObserver);
		},
		async framesReady(count = 1) {
			await vi.waitFor(() => expect(shown.length).toBeGreaterThanOrEqual(count));
		},
	};
}

afterEach(() => {
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('ForkEmojiNearViewport', () => {
	it('tells each emoji when it comes near the viewport or leaves it, and its size, with one observer for all', () => {
		let callback: IntersectionObserverCallback | null = null;
		const unobserve = vi.fn();
		const createObserver = vi.fn((observerCallback: IntersectionObserverCallback) => {
			callback = observerCallback;
			return {observe: () => {}, unobserve};
		});
		const viewport = new ForkEmojiNearViewport(createObserver);
		const first = document.createElement('img');
		const second = document.createElement('img');
		const firstListener = vi.fn();
		const secondListener = vi.fn();
		const stopFirst = viewport.observe(first, firstListener);
		viewport.observe(second, secondListener);
		expect(createObserver).toHaveBeenCalledTimes(1);
		const entry = (target: Element, isIntersecting: boolean) =>
			({target, isIntersecting, boundingClientRect: {width: 24, height: 20}}) as unknown as IntersectionObserverEntry;
		callback!([entry(first, true)], {} as IntersectionObserver);
		expect(firstListener).toHaveBeenCalledWith(true, 24);
		expect(secondListener).not.toHaveBeenCalled();
		stopFirst();
		expect(unobserve).toHaveBeenCalledWith(first);
		callback!([entry(first, false)], {} as IntersectionObserver);
		expect(firstListener).toHaveBeenCalledTimes(1);
	});
});

describe('ForkSyncedEmojiImages', () => {
	it('fetches nothing for an animated emoji until it comes near the viewport, then shows its frames', async () => {
		const harness = createHarness();
		const img = harness.addImage(WINGS_L);
		expect(harness.load).not.toHaveBeenCalled();
		harness.setNear(img, true);
		// 24 CSS pixels on a screen with two device pixels each.
		expect(harness.acquire).toHaveBeenCalledWith(WINGS_L, 48);
		expect(harness.shown).toHaveLength(0);
		await harness.framesReady();
		expect(harness.showing()).toHaveLength(1);
		expect(harness.shown[0].img).toBe(img);
		expect(img.nextSibling).toBe(harness.shown[0].canvas);
		expect(img.getAttribute('src')).toBe(WINGS_L);
	});

	it('leaves every other image alone', () => {
		const harness = createHarness();
		for (const src of [
			WINGS_L_STILL,
			'https://media.example/avatars/1/a_abc.webp?animated=true',
			'https://static.example/emoji/1f600.svg',
		]) {
			harness.setNear(harness.addImage(src), true);
		}
		expect(harness.acquire).not.toHaveBeenCalled();
		expect(harness.observedForMutations).toHaveLength(0);
	});

	it('fetches an emoji once for every copy on the page, and failing that, never again', async () => {
		const harness = createHarness();
		const imgs = Array.from({length: 8}, () => harness.addImage(WINGS_L));
		for (const img of imgs) harness.setNear(img, true);
		await harness.framesReady(8);
		expect(harness.load).toHaveBeenCalledTimes(1);
		expect(harness.decode).toHaveBeenCalledTimes(1);

		const failing = createHarness();
		failing.load.mockRejectedValue(new Error('offline'));
		const first = failing.addImage(WINGS_R);
		failing.setNear(first, true);
		await vi.waitFor(() => expect(failing.load).toHaveBeenCalledTimes(1));
		for (let attempt = 0; attempt < 5; attempt++) failing.setNear(failing.addImage(WINGS_R), true);
		await Promise.resolve();
		expect(failing.load).toHaveBeenCalledTimes(1);
		expect(failing.shown).toHaveLength(0);
	});

	it('takes the canvas away when the emoji leaves the viewport, lets its frames go, and brings them back', async () => {
		vi.useFakeTimers();
		const harness = createHarness({keepUnusedMs: 1000});
		const img = harness.addImage(WINGS_L);
		harness.setNear(img, true);
		await harness.framesReady();
		harness.setNear(img, false);
		expect(harness.showing()).toHaveLength(0);
		expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
		// Back within the time the frames are kept: shown at once, nothing fetched.
		harness.setNear(img, true);
		expect(harness.showing()).toHaveLength(1);
		expect(harness.load).toHaveBeenCalledTimes(1);
		// Away for longer: the frames were let go, so they are dropped and fetched again.
		harness.setNear(img, false);
		vi.advanceTimersByTime(1000);
		harness.setNear(img, true);
		expect(harness.load).toHaveBeenCalledTimes(2);
		await harness.framesReady(3);
		expect(harness.showing()).toHaveLength(1);
	});

	it("shows upstream's image again at once when its address changes, and looks at it anew when it has loaded", async () => {
		const harness = createHarness();
		const img = harness.addImage(WINGS_L);
		harness.setNear(img, true);
		await harness.framesReady();
		// The pointer leaves: upstream gives the image its still address.
		img.setAttribute('src', WINGS_L_STILL);
		harness.srcChanged(img);
		expect(harness.showing()).toHaveLength(0);
		harness.loaded(img);
		harness.setNear(img, true);
		expect(harness.showing()).toHaveLength(0);
		// A picker cell is reused for another emoji.
		img.setAttribute('src', WINGS_R);
		harness.srcChanged(img);
		harness.loaded(img);
		harness.setNear(img, true);
		await harness.framesReady(2);
		expect(harness.showing()).toHaveLength(1);
		expect(harness.acquire).toHaveBeenLastCalledWith(WINGS_R, 48);
	});

	it('takes the canvas away when upstream removes the image', async () => {
		const harness = createHarness();
		const parent = document.createElement('p');
		document.body.append(parent);
		const img = harness.addImage(WINGS_L, parent);
		const other = harness.addImage(WINGS_R, parent);
		harness.setNear(img, true);
		harness.setNear(other, true);
		await harness.framesReady(2);
		expect(harness.observedForMutations).toContainEqual([parent, {childList: true}]);
		img.remove();
		expect(parent.querySelectorAll('canvas')).toHaveLength(2);
		harness.childrenChanged(parent);
		expect(parent.querySelectorAll('canvas')).toHaveLength(1);
		expect(harness.showing().map((entry) => entry.img)).toEqual([other]);
	});

	it('follows an image that is moved to another parent', async () => {
		const harness = createHarness();
		const from = document.createElement('p');
		const to = document.createElement('p');
		document.body.append(from, to);
		const img = harness.addImage(WINGS_L, from);
		harness.setNear(img, true);
		await harness.framesReady();
		to.append(img);
		harness.childrenChanged(from);
		expect(from.querySelectorAll('canvas')).toHaveLength(0);
		harness.setNear(img, true);
		expect(img.nextSibling).toBe(harness.showing()[0].canvas);
	});

	it('leaves an image alone for good where something else takes its canvas out of the page', async () => {
		const harness = createHarness();
		const parent = document.createElement('p');
		document.body.append(parent);
		const img = harness.addImage(WINGS_L, parent);
		harness.setNear(img, true);
		await harness.framesReady();
		harness.shown[0].canvas.remove();
		harness.childrenChanged(parent);
		expect(harness.showing()).toHaveLength(0);
		harness.loaded(img);
		harness.setNear(img, true);
		expect(harness.showing()).toHaveLength(0);
		expect(parent.querySelectorAll('canvas')).toHaveLength(0);
	});

	it('asks for frames of the size the player says the emoji is really drawn at, and keeps the ones shown meanwhile', async () => {
		let finishDecoding: () => void = () => {};
		const harness = createHarness();
		const img = harness.addImage(WINGS_L);
		harness.setNear(img, true);
		await harness.framesReady();
		harness.shown[0].onDevicePixels?.(47);
		expect(harness.acquire).toHaveBeenCalledTimes(1);
		harness.decode.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => (finishDecoding = resolve));
			return makeFrames();
		});
		harness.shown[0].onDevicePixels?.(72);
		expect(harness.acquire).toHaveBeenLastCalledWith(WINGS_L, 80);
		await vi.waitFor(() => expect(harness.decode).toHaveBeenCalledTimes(2));
		expect(harness.showing()).toEqual([harness.shown[0]]);
		finishDecoding();
		await harness.framesReady(2);
		expect(harness.showing()).toEqual([harness.shown[1]]);
		expect(document.body.querySelectorAll('canvas')).toHaveLength(1);
	});

	it('stops when it is taken out of the document again', async () => {
		const harness = createHarness();
		const img = harness.addImage(WINGS_L);
		harness.setNear(img, true);
		await harness.framesReady();
		harness.uninstall();
		expect(harness.showing()).toHaveLength(0);
		expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
		harness.setNear(harness.addImage(WINGS_R), true);
		expect(harness.acquire).toHaveBeenCalledTimes(1);
	});
});
