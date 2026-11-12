// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {createForkEmojiTimeline} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import {
	type ForkEmojiFrames,
	ForkEmojiFramesStore,
	type ForkEmojiSource,
	forkEmojiFrameSize,
	isForkSyncableEmojiUrl,
	loadForkEmojiSource,
} from '@app/features/expressions/utils/ForkSyncedEmojiFrames';
import {afterEach, describe, expect, it, vi} from 'vitest';

// Upstream's probe for builds that decode animated AVIF without its transparency.
const avif = vi.hoisted(() => ({decodesWithAlpha: true}));
vi.mock('@app/features/platform/utils/ImageDecoderInterop', async (original) => ({
	...(await original<typeof import('@app/features/platform/utils/ImageDecoderInterop')>()),
	canDecodeAnimatedAvif: async () => avif.decodesWithAlpha,
}));

const WING_DURATIONS = [
	...Array.from({length: 12}, () => 20),
	...Array.from({length: 18}, () => 30),
	...Array.from({length: 4}, () => 70),
];

interface FakeBitmap {
	width: number;
	height: number;
	close: ReturnType<typeof vi.fn>;
}

function makeFrames(durations: ReadonlyArray<number>, width = 32, height = 32): ForkEmojiFrames {
	const frames = durations.map((): FakeBitmap => ({width, height, close: vi.fn()}));
	return {frames: frames as unknown as Array<ImageBitmap>, timeline: createForkEmojiTimeline(durations)};
}

function closedCount(frames: ForkEmojiFrames): number {
	return (frames.frames as unknown as Array<FakeBitmap>).filter((frame) => frame.close.mock.calls.length > 0).length;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('emoji URLs', () => {
	it('takes animated custom emoji URLs only as ones to keep in step', () => {
		expect(
			isForkSyncableEmojiUrl('https://temple.example/media/emojis/1553996962712256512.webp?animated=true&size=128'),
		).toBe(true);
		expect(isForkSyncableEmojiUrl('https://media.example/emojis/1.gif?size=240&animated=true')).toBe(true);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/emojis/1553996962712256512.webp?size=128')).toBe(false);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/emojis/1.webp?animated=false')).toBe(false);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/stickers/1.webp?animated=true')).toBe(false);
		expect(isForkSyncableEmojiUrl('https://temple.example/media/avatars/1/a_abc.webp?animated=true')).toBe(false);
		expect(isForkSyncableEmojiUrl('/assets/emoji/1f600.svg')).toBe(false);
		expect(isForkSyncableEmojiUrl('blob:https://temple.example/7d1f')).toBe(false);
		expect(isForkSyncableEmojiUrl('')).toBe(false);
	});

	it("reads the emoji's own address through the desktop app's proxy for servers without https", () => {
		const real = 'http://chat.home.example/media/emojis/1553996962712256512.webp?animated=true&size=128';
		const proxied = `fluxer-app://app/proxy/instance-key?url=${encodeURIComponent(real)}`;
		expect(isForkSyncableEmojiUrl(proxied)).toBe(true);
		expect(forkEmojiFrameSize(proxied, 300)).toBe(128);
		const still = `fluxer-app://app/proxy/instance-key?url=${encodeURIComponent(real.replace('animated=true&', ''))}`;
		expect(isForkSyncableEmojiUrl(still)).toBe(false);
	});

	it('asks for frames of the size shown, in steps, and no larger than the image the URL names', () => {
		const url = 'https://media.example/emojis/1.webp?animated=true&size=128';
		expect(forkEmojiFrameSize(url, 20)).toBe(32);
		expect(forkEmojiFrameSize(url, 25)).toBe(32);
		expect(forkEmojiFrameSize(url, 48)).toBe(48);
		expect(forkEmojiFrameSize(url, 49)).toBe(64);
		expect(forkEmojiFrameSize(url, 300)).toBe(128);
		expect(forkEmojiFrameSize(url, 0)).toBe(16);
		expect(forkEmojiFrameSize('https://media.example/emojis/1.webp?animated=true', 300)).toBe(304);
	});
});

describe('ForkEmojiFramesStore', () => {
	const URL_ONE = 'https://media.example/emojis/1.webp?animated=true&size=128';

	afterEach(() => {
		vi.useRealTimers();
	});

	function sourceOf(decode: ForkEmojiSource['decode']): ForkEmojiSource {
		return {decode};
	}

	it('fetches a URL once however many emoji show it, and decodes each size once', async () => {
		const decode = vi.fn(async () => makeFrames(WING_DURATIONS));
		const load = vi.fn(async () => sourceOf(decode));
		const store = new ForkEmojiFramesStore(load);
		const releases = [
			...Array.from({length: 8}, () => store.acquire(URL_ONE, 32)),
			...Array.from({length: 3}, () => store.acquire(URL_ONE, 48)),
		];
		expect(store.peek(URL_ONE, 32)).toEqual({status: 'loading'});
		await vi.waitFor(() => expect(store.peek(URL_ONE, 32)?.status).toBe('ready'));
		await vi.waitFor(() => expect(store.peek(URL_ONE, 48)?.status).toBe('ready'));
		expect(load).toHaveBeenCalledTimes(1);
		expect(decode.mock.calls).toEqual([[32], [48]]);
		expect(store.peek(URL_ONE, 32)).not.toBe(store.peek(URL_ONE, 48));
		for (const release of releases) release();
	});

	it('does not fetch a URL again after it failed', async () => {
		const load = vi.fn(async (): Promise<ForkEmojiSource | null> => {
			throw new Error('offline');
		});
		const store = new ForkEmojiFramesStore(load);
		const listener = vi.fn();
		store.subscribe(listener);
		const release = store.acquire(URL_ONE, 32);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 32)).toEqual({status: 'failed'}));
		expect(listener).toHaveBeenCalledTimes(1);
		release();
		for (let attempt = 0; attempt < 5; attempt++) {
			store.acquire(URL_ONE, 32)();
			store.acquire(URL_ONE, 64)();
		}
		expect(store.peek(URL_ONE, 64)).toEqual({status: 'failed'});
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('gives up on a URL that is not an endless animation, at every size', async () => {
		const decode = vi.fn(async (): Promise<ForkEmojiFrames | null> => null);
		const load = vi.fn(async () => sourceOf(decode));
		const store = new ForkEmojiFramesStore(load);
		store.acquire(URL_ONE, 32);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 32)).toEqual({status: 'failed'}));
		store.acquire(URL_ONE, 48);
		expect(store.peek(URL_ONE, 48)).toEqual({status: 'failed'});
		expect(decode).toHaveBeenCalledTimes(1);
	});

	it('keeps an emoji and its other sizes when decoding one size breaks off, and does not try that size again', async () => {
		const small = makeFrames(WING_DURATIONS);
		const decode = vi.fn(async (size: number) => {
			if (size === 128) throw new Error('out of memory');
			return size === 32 ? small : makeFrames(WING_DURATIONS, size, size);
		});
		const load = vi.fn(async () => sourceOf(decode));
		const store = new ForkEmojiFramesStore(load);
		store.acquire(URL_ONE, 128);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 128)).toEqual({status: 'failed'}));
		store.acquire(URL_ONE, 32);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 32)).toEqual({status: 'ready', frames: small}));
		// The size that could not be made is drawn from the frames there are.
		expect(store.peek(URL_ONE, 128)).toEqual({status: 'ready', frames: small});
		expect(closedCount(small)).toBe(0);
		store.acquire(URL_ONE, 128)();
		store.acquire(URL_ONE, 48);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 48)?.status).toBe('ready'));
		expect(decode.mock.calls.map(([size]) => size)).toEqual([128, 32, 48]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('shows the frames it has while another size is decoded', async () => {
		const small = makeFrames(WING_DURATIONS);
		const large = makeFrames(WING_DURATIONS, 64, 64);
		let finishLarge: (frames: ForkEmojiFrames) => void = () => {};
		const decode = vi.fn((size: number) =>
			size === 32 ? Promise.resolve(small) : new Promise<ForkEmojiFrames>((resolve) => (finishLarge = resolve)),
		);
		const store = new ForkEmojiFramesStore(async () => sourceOf(decode));
		store.acquire(URL_ONE, 32);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 32)).toEqual({status: 'ready', frames: small}));
		store.acquire(URL_ONE, 64);
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		expect(store.peek(URL_ONE, 64)).toEqual({status: 'ready', frames: small});
		finishLarge(large);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 64)).toEqual({status: 'ready', frames: large}));
	});

	it('drops frames nobody shows after a while, telling whoever draws them first, and loads them again when needed', async () => {
		vi.useFakeTimers();
		const frames = makeFrames(WING_DURATIONS);
		const load = vi.fn(async () => sourceOf(async () => frames));
		const store = new ForkEmojiFramesStore(load, 1000);
		const closedWhenTold: Array<number> = [];
		store.subscribe(() => closedWhenTold.push(closedCount(frames)));
		const release = store.acquire(URL_ONE, 32);
		await vi.waitFor(() => expect(store.peek(URL_ONE, 32)?.status).toBe('ready'));
		release();
		vi.advanceTimersByTime(999);
		expect(store.peek(URL_ONE, 32)?.status).toBe('ready');
		const again = store.acquire(URL_ONE, 32);
		vi.advanceTimersByTime(5000);
		expect(store.peek(URL_ONE, 32)?.status).toBe('ready');
		expect(closedCount(frames)).toBe(0);
		again();
		vi.advanceTimersByTime(1000);
		expect(store.peek(URL_ONE, 32)).toBeNull();
		expect(closedCount(frames)).toBe(WING_DURATIONS.length);
		expect(closedWhenTold).toEqual([0, 0]);
		store.acquire(URL_ONE, 32);
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe('loadForkEmojiSource', () => {
	const URL_TO_LOAD = 'https://media.example/emojis/1553996962712256512.webp?animated=true&size=128';

	interface FakeTrack {
		frameCount: number;
		repetitionCount: number;
		animated: boolean;
	}

	function installFakes({
		track,
		width = 128,
		height = 128,
		ok = true,
		failAtFrame = -1,
		type = 'image/gif',
	}: {
		track: FakeTrack;
		width?: number;
		height?: number;
		ok?: boolean;
		failAtFrame?: number;
		type?: string;
	}) {
		const frameClosed = vi.fn();
		const decoderClosed = vi.fn();
		const bitmaps: Array<FakeBitmap> = [];
		class FakeImageDecoder {
			static isTypeSupported = vi.fn(async (supported: string) => supported === type);
			tracks = {ready: Promise.resolve(), selectedTrack: track};
			completed = Promise.resolve();
			async decode({frameIndex = 0}: {frameIndex?: number} = {}) {
				return {
					image: {
						displayWidth: width,
						displayHeight: height,
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
		const createBitmap = vi.fn(async (_image: unknown, options: {resizeWidth: number; resizeHeight: number}) => {
			if (bitmaps.length === failAtFrame) throw new Error('out of memory');
			const bitmap = {width: options.resizeWidth, height: options.resizeHeight, close: vi.fn()};
			bitmaps.push(bitmap);
			return bitmap;
		});
		const fetchMock = vi.fn(
			async () => new Response(new Uint8Array([71, 73, 70]), {status: ok ? 200 : 404, headers: {'content-type': type}}),
		);
		vi.stubGlobal('ImageDecoder', FakeImageDecoder);
		vi.stubGlobal('createImageBitmap', createBitmap);
		vi.stubGlobal('fetch', fetchMock);
		return {frameClosed, decoderClosed, bitmaps, createBitmap, fetchMock};
	}

	const ENDLESS = {frameCount: 34, repetitionCount: Number.POSITIVE_INFINITY, animated: true};

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('fetches the emoji once and decodes its frames at the size asked for, each with its duration', async () => {
		const fakes = installFakes({track: ENDLESS});
		const source = await loadForkEmojiSource(URL_TO_LOAD);
		const frames = await source?.decode(48);
		expect(frames?.frames).toHaveLength(34);
		// 20 ms for even frames; 0 ms for odd ones, shown for 100 ms as browsers do.
		expect(frames?.timeline.loopMs).toBe(17 * 20 + 17 * 100);
		expect(fakes.createBitmap).toHaveBeenCalledTimes(34);
		expect(fakes.createBitmap.mock.calls[0][1]).toEqual({resizeWidth: 48, resizeHeight: 48, resizeQuality: 'high'});
		expect(fakes.frameClosed).toHaveBeenCalledTimes(34);
		expect(fakes.decoderClosed).toHaveBeenCalledTimes(1);
		const larger = await source?.decode(96);
		expect(larger?.frames[0].width).toBe(96);
		expect(fakes.fetchMock).toHaveBeenCalledTimes(1);
	});

	it('never makes a frame larger than the image, and keeps its proportions', async () => {
		installFakes({track: ENDLESS, width: 128, height: 80});
		const source = await loadForkEmojiSource(URL_TO_LOAD);
		const full = await source?.decode(256);
		expect([full?.frames[0].width, full?.frames[0].height]).toEqual([128, 80]);
		const small = await source?.decode(48);
		expect([small?.frames[0].width, small?.frames[0].height]).toEqual([48, 30]);
	});

	it('makes the frames of a long animation smaller, to keep them all within the memory limit', async () => {
		installFakes({
			track: {frameCount: 600, repetitionCount: Number.POSITIVE_INFINITY, animated: true},
			width: 240,
			height: 240,
		});
		const frames = await (await loadForkEmojiSource(URL_TO_LOAD))?.decode(240);
		expect(frames?.frames).toHaveLength(600);
		expect(frames?.frames[0].width).toBe(59);
		expect(600 * 59 * 59 * 4).toBeLessThanOrEqual(8 * 1024 * 1024);
	});

	it('leaves play-once animations and endless films to the browser', async () => {
		const once = installFakes({track: {frameCount: 34, repetitionCount: 0, animated: true}});
		expect(await (await loadForkEmojiSource(URL_TO_LOAD))?.decode(48)).toBeNull();
		expect(once.decoderClosed).toHaveBeenCalledTimes(1);
		const film = installFakes({track: {frameCount: 1201, repetitionCount: Number.POSITIVE_INFINITY, animated: true}});
		expect(await (await loadForkEmojiSource(URL_TO_LOAD))?.decode(48)).toBeNull();
		expect(film.createBitmap).not.toHaveBeenCalled();
	});

	it('closes the frames it made when one cannot be made', async () => {
		const fakes = installFakes({track: ENDLESS, failAtFrame: 5});
		const source = await loadForkEmojiSource(URL_TO_LOAD);
		await expect(source?.decode(48)).rejects.toThrow('out of memory');
		expect(fakes.bitmaps).toHaveLength(5);
		expect(fakes.bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
		expect(fakes.frameClosed).toHaveBeenCalledTimes(6);
		expect(fakes.decoderClosed).toHaveBeenCalledTimes(1);
	});

	it('leaves animated AVIF to the browser where it would be decoded without its transparency', async () => {
		installFakes({track: ENDLESS, type: 'image/avif'});
		avif.decodesWithAlpha = false;
		expect(await loadForkEmojiSource(URL_TO_LOAD)).toBeNull();
		avif.decodesWithAlpha = true;
		expect(await loadForkEmojiSource(URL_TO_LOAD)).not.toBeNull();
	});

	it('gives up without decoding when the fetch fails', async () => {
		const fakes = installFakes({track: ENDLESS, ok: false});
		expect(await loadForkEmojiSource(URL_TO_LOAD)).toBeNull();
		expect(fakes.decoderClosed).not.toHaveBeenCalled();
	});
});
