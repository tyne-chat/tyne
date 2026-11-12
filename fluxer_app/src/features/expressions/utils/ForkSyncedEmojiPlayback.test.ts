// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {createForkEmojiTimeline} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import {
	ForkEmojiNearViewport,
	type ForkEmojiStrip,
	ForkEmojiStripStore,
	ForkSyncedEmojiPlayer,
	type ForkSyncedEmojiPlayerEnvironment,
	forkEmojiStripPosition,
	isForkSyncableEmojiUrl,
	loadForkEmojiStrip,
} from '@app/features/expressions/utils/ForkSyncedEmojiPlayback';
import {afterEach, describe, expect, it, vi} from 'vitest';

const WING_DURATIONS = [
	...Array.from({length: 12}, () => 20),
	...Array.from({length: 18}, () => 30),
	...Array.from({length: 4}, () => 70),
];

function makeStrip(url: string, durations: ReadonlyArray<number>): ForkEmojiStrip {
	return {url, frameCount: durations.length, timeline: createForkEmojiTimeline(durations)};
}

function createFakeEnvironment() {
	let now = 1000;
	let pendingFrame: ((time: number) => void) | null = null;
	let handles = 0;
	let intersectionCallback: IntersectionObserverCallback | null = null;
	const environment: ForkSyncedEmojiPlayerEnvironment = {
		now: () => now,
		requestFrame: (callback) => {
			pendingFrame = callback;
			handles += 1;
			return handles;
		},
		cancelFrame: () => {
			pendingFrame = null;
		},
		observe: (callback) => {
			intersectionCallback = callback;
			return {observe: () => {}, unobserve: () => {}};
		},
	};
	return {
		environment,
		// Moves time on by `ms` and runs the animation frame the player asked for, if any.
		advance(ms: number) {
			now += ms;
			const frame = pendingFrame;
			pendingFrame = null;
			frame?.(now);
		},
		hasPendingFrame: () => pendingFrame !== null,
		setInViewport(img: HTMLImageElement, inViewport: boolean) {
			intersectionCallback?.(
				[{target: img, isIntersecting: inViewport} as unknown as IntersectionObserverEntry],
				{} as IntersectionObserver,
			);
		},
	};
}

function frameShown(img: HTMLImageElement, strip: ForkEmojiStrip): number {
	for (let frame = 0; frame < strip.frameCount; frame++) {
		if (img.style.getPropertyValue('object-position') === forkEmojiStripPosition(frame, strip.frameCount)) {
			return frame;
		}
	}
	return -1;
}

describe('isForkSyncableEmojiUrl', () => {
	it('matches animated custom emoji URLs only', () => {
		expect(
			isForkSyncableEmojiUrl('https://temple.example/media/emojis/1553996962712256512.webp?animated=true&size=128'),
		).toBe(true);
		expect(isForkSyncableEmojiUrl('https://media.example/emojis/1.gif?size=240&animated=true')).toBe(true);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/emojis/1553996962712256512.webp?size=128')).toBe(false);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/emojis/1.webp?animated=false')).toBe(false);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/stickers/1.webp?animated=true')).toBe(false);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/avatars/1/a_abc.webp?animated=true')).toBe(false);
		expect(isForkSyncableEmojiUrl('/assets/emoji/1f600.svg')).toBe(false);
	});
});

describe('ForkSyncedEmojiPlayer', () => {
	it('starts the first emoji at its first frame and follows its durations', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const strip = makeStrip('blob:left', [100, 50, 250]);
		const img = document.createElement('img');
		player.attach(img, strip);
		expect(frameShown(img, strip)).toBe(0);
		fake.advance(99);
		expect(frameShown(img, strip)).toBe(0);
		fake.advance(1);
		expect(frameShown(img, strip)).toBe(1);
		fake.advance(50);
		expect(frameShown(img, strip)).toBe(2);
		fake.advance(250);
		expect(frameShown(img, strip)).toBe(0);
	});

	it('shows an emoji attached 370 ms later on the same frame as the one already playing', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const left = makeStrip('blob:left', WING_DURATIONS);
		const right = makeStrip('blob:right', WING_DURATIONS);
		const leftImg = document.createElement('img');
		const rightImg = document.createElement('img');
		player.attach(leftImg, left);
		for (let time = 0; time < 370; time += 10) fake.advance(10);
		player.attach(rightImg, right);
		expect(frameShown(rightImg, right)).toBe(frameShown(leftImg, left));
		expect(frameShown(rightImg, right)).not.toBe(0);
		for (let time = 0; time < 2500; time += 16) {
			fake.advance(16);
			expect(frameShown(rightImg, right)).toBe(frameShown(leftImg, left));
		}
	});

	it('starts an emoji with another loop length at its first frame while the wings play', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const wing = makeStrip('blob:wing', WING_DURATIONS);
		const sleepy = makeStrip('blob:sleepy', [40, 40, 600]);
		const wingImg = document.createElement('img');
		const sleepyImg = document.createElement('img');
		player.attach(wingImg, wing);
		fake.advance(500);
		player.attach(sleepyImg, sleepy);
		expect(frameShown(sleepyImg, sleepy)).toBe(0);
		expect(frameShown(wingImg, wing)).not.toBe(0);
	});

	it('starts the next emoji at its first frame once none with its loop length is shown', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const wing = makeStrip('blob:wing', WING_DURATIONS);
		const first = document.createElement('img');
		const detach = player.attach(first, wing);
		fake.advance(400);
		detach();
		expect(first.style.getPropertyValue('object-position')).toBe('');
		fake.advance(16);
		expect(fake.hasPendingFrame()).toBe(false);
		fake.advance(300);
		const second = document.createElement('img');
		player.attach(second, wing);
		expect(frameShown(second, wing)).toBe(0);
	});

	it('keeps the clock when one emoji replaces another in the same render', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const wing = makeStrip('blob:wing', WING_DURATIONS);
		const other = document.createElement('img');
		player.attach(other, wing);
		const before = document.createElement('img');
		const detach = player.attach(before, wing);
		fake.advance(400);
		detach();
		const after = document.createElement('img');
		player.attach(after, wing);
		fake.advance(16);
		expect(frameShown(after, wing)).toBe(frameShown(other, wing));
		expect(frameShown(after, wing)).not.toBe(0);
	});

	it('does not hold a clock for an emoji outside the viewport, and lines it up when it comes back', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const left = makeStrip('blob:left', WING_DURATIONS);
		const right = makeStrip('blob:right', WING_DURATIONS);
		const leftImg = document.createElement('img');
		player.attach(leftImg, left);
		fake.advance(300);
		fake.setInViewport(leftImg, false);
		fake.advance(16);
		expect(fake.hasPendingFrame()).toBe(false);
		fake.advance(1000);
		const rightImg = document.createElement('img');
		player.attach(rightImg, right);
		expect(frameShown(rightImg, right)).toBe(0);
		fake.advance(250);
		fake.setInViewport(leftImg, true);
		expect(frameShown(leftImg, left)).toBe(frameShown(rightImg, right));
		fake.advance(16);
		expect(frameShown(leftImg, left)).toBe(frameShown(rightImg, right));
	});
});

describe('ForkEmojiNearViewport', () => {
	it('tells each emoji when it comes near the viewport or leaves it, with one observer for all', () => {
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
		callback!(
			[{target: first, isIntersecting: true} as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		expect(firstListener).toHaveBeenCalledWith(true);
		expect(secondListener).not.toHaveBeenCalled();
		stopFirst();
		expect(unobserve).toHaveBeenCalledWith(first);
		callback!(
			[{target: first, isIntersecting: false} as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		expect(firstListener).toHaveBeenCalledTimes(1);
	});
});

describe('ForkEmojiStripStore', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function loadedStrip(url: string) {
		return {strip: makeStrip(url, WING_DURATIONS), preloaded: document.createElement('img')};
	}

	it('loads a URL once however many emoji show it', async () => {
		const load = vi.fn(async (src: string) => loadedStrip(`blob:${src}`));
		const store = new ForkEmojiStripStore(load);
		const releases = Array.from({length: 8}, () => store.acquire('https://media.example/emojis/1.webp?animated=true'));
		expect(store.peek('https://media.example/emojis/1.webp?animated=true')).toEqual({status: 'loading'});
		await vi.waitFor(() =>
			expect(store.peek('https://media.example/emojis/1.webp?animated=true')?.status).toBe('ready'),
		);
		expect(load).toHaveBeenCalledTimes(1);
		for (const release of releases) release();
	});

	it('does not load a URL again after it failed', async () => {
		const load = vi.fn(async () => {
			throw new Error('offline');
		});
		const store = new ForkEmojiStripStore(load);
		const url = 'https://media.example/emojis/2.webp?animated=true';
		const release = store.acquire(url);
		await vi.waitFor(() => expect(store.peek(url)).toEqual({status: 'failed'}));
		release();
		for (let attempt = 0; attempt < 5; attempt++) {
			store.acquire(url)();
		}
		expect(store.peek(url)).toEqual({status: 'failed'});
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('drops a strip nobody shows after a while, and loads it again when it is needed', async () => {
		vi.useFakeTimers();
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const load = vi.fn(async () => loadedStrip('blob:three'));
		const store = new ForkEmojiStripStore(load, 1000);
		const url = 'https://media.example/emojis/3.webp?animated=true';
		const listener = vi.fn();
		store.subscribe(listener);
		const release = store.acquire(url);
		await vi.waitFor(() => expect(store.peek(url)?.status).toBe('ready'));
		release();
		vi.advanceTimersByTime(999);
		expect(store.peek(url)?.status).toBe('ready');
		const again = store.acquire(url);
		vi.advanceTimersByTime(5000);
		expect(store.peek(url)?.status).toBe('ready');
		again();
		vi.advanceTimersByTime(1000);
		expect(store.peek(url)).toBeNull();
		expect(revoke).toHaveBeenCalledWith('blob:three');
		expect(listener).toHaveBeenCalledTimes(2);
		store.acquire(url);
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe('loadForkEmojiStrip', () => {
	const URL_TO_LOAD = 'https://media.example/emojis/1553996962712256512.webp?animated=true&size=128';

	interface FakeTrack {
		frameCount: number;
		repetitionCount: number;
		animated: boolean;
	}

	function installFakes({track, size = 128, ok = true}: {track: FakeTrack; size?: number; ok?: boolean}) {
		const drawn: Array<{x: number; y: number; width: number; height: number}> = [];
		const frameClosed = vi.fn();
		const decoderClosed = vi.fn();
		const canvases: Array<{width: number; height: number}> = [];
		class FakeImageDecoder {
			static isTypeSupported = vi.fn(async (type: string) => type === 'image/gif');
			tracks = {ready: Promise.resolve(), selectedTrack: track};
			completed = Promise.resolve();
			async decode({frameIndex = 0}: {frameIndex?: number} = {}) {
				return {
					image: {
						displayWidth: size,
						displayHeight: size,
						duration: frameIndex % 2 === 0 ? 20_000 : 0,
						close: frameClosed,
					},
					complete: true,
				};
			}
			close() {
				decoderClosed();
			}
		}
		class FakeOffscreenCanvas {
			constructor(
				public width: number,
				public height: number,
			) {
				canvases.push(this);
			}
			getContext() {
				return {
					imageSmoothingQuality: 'low',
					drawImage: (_image: unknown, x: number, y: number, width: number, height: number) => {
						drawn.push({x, y, width, height});
					},
				};
			}
			async convertToBlob() {
				return new Blob(['strip'], {type: 'image/png'});
			}
		}
		const fetchMock = vi.fn(
			async () =>
				new Response(new Uint8Array([71, 73, 70]), {status: ok ? 200 : 404, headers: {'content-type': 'image/gif'}}),
		);
		vi.stubGlobal('ImageDecoder', FakeImageDecoder);
		vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:strip');
		vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
		return {drawn, frameClosed, decoderClosed, canvases, fetchMock};
	}

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('fetches the emoji once and lays its frames side by side, each with its duration', async () => {
		const fakes = installFakes({track: {frameCount: 34, repetitionCount: Number.POSITIVE_INFINITY, animated: true}});
		const loaded = await loadForkEmojiStrip(URL_TO_LOAD);
		expect(fakes.fetchMock).toHaveBeenCalledTimes(1);
		expect(loaded?.strip.url).toBe('blob:strip');
		expect(loaded?.strip.frameCount).toBe(34);
		// 20 ms for even frames; 0 ms for odd ones, shown for 100 ms as browsers do.
		expect(loaded?.strip.timeline.loopMs).toBe(17 * 20 + 17 * 100);
		expect(fakes.canvases).toEqual([{width: 34 * 128 + 33 * 16, height: 128}]);
		expect(fakes.drawn).toHaveLength(34);
		expect(fakes.drawn[0]).toEqual({x: 0, y: 0, width: 128, height: 128});
		expect(fakes.drawn[1]).toEqual({x: 144, y: 0, width: 128, height: 128});
		expect(fakes.frameClosed).toHaveBeenCalledTimes(34);
		expect(fakes.decoderClosed).toHaveBeenCalledTimes(1);
	});

	it('leaves play-once animations to the browser', async () => {
		const fakes = installFakes({track: {frameCount: 34, repetitionCount: 0, animated: true}});
		expect(await loadForkEmojiStrip(URL_TO_LOAD)).toBeNull();
		expect(fakes.decoderClosed).toHaveBeenCalledTimes(1);
	});

	it('scales the frames of a long animation down to fit the widest strip', async () => {
		const fakes = installFakes({
			track: {frameCount: 200, repetitionCount: Number.POSITIVE_INFINITY, animated: true},
			size: 240,
		});
		const loaded = await loadForkEmojiStrip(URL_TO_LOAD);
		expect(loaded?.strip.frameCount).toBe(200);
		expect(fakes.canvases[0].height).toBe(72);
		expect(fakes.canvases[0].width).toBeLessThanOrEqual(16384);
	});

	it('gives up without decoding when the fetch fails', async () => {
		const fakes = installFakes({
			track: {frameCount: 34, repetitionCount: Number.POSITIVE_INFINITY, animated: true},
			ok: false,
		});
		expect(await loadForkEmojiStrip(URL_TO_LOAD)).toBeNull();
		expect(fakes.decoderClosed).not.toHaveBeenCalled();
	});
});
