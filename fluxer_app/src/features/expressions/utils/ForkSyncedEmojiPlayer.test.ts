// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {createForkEmojiTimeline} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import type {ForkEmojiFrames} from '@app/features/expressions/utils/ForkSyncedEmojiFrames';
import {
	FORK_EMOJI_ANCHOR_ATTRIBUTE,
	FORK_EMOJI_CANVAS_ATTRIBUTE,
	FORK_EMOJI_SYNCED_ATTRIBUTE,
	type ForkShownEmoji,
	ForkSyncedEmojiPlayer,
	type ForkSyncedEmojiPlayerEnvironment,
	forkEmojiCanvasStaysWithImage,
} from '@app/features/expressions/utils/ForkSyncedEmojiPlayer';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const WING_DURATIONS = [
	...Array.from({length: 12}, () => 20),
	...Array.from({length: 18}, () => 30),
	...Array.from({length: 4}, () => 70),
];

function makeFrames(durations: ReadonlyArray<number>, width = 32, height = 32): ForkEmojiFrames {
	const frames = durations.map(() => ({width, height, close: () => {}}));
	return {frames: frames as unknown as Array<ImageBitmap>, timeline: createForkEmojiTimeline(durations)};
}

function createFakeEnvironment({ratio = 1, canHide = true}: {ratio?: number; canHide?: boolean} = {}) {
	let pixelRatio = ratio;
	let now = 1000;
	let pendingFrame: ((time: number) => void) | null = null;
	let handles = 0;
	let framesRun = 0;
	let timers: Array<{at: number; callback: () => void}> = [];
	let sizeCallback: ResizeObserverCallback | null = null;
	const observed = new Map<Element, ResizeObserverOptions | undefined>();
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
		setTimer: (callback, ms) => {
			const timer = {at: now + ms, callback};
			timers.push(timer);
			return timer;
		},
		clearTimer: (handle) => {
			timers = timers.filter((timer) => timer !== handle);
		},
		observeSize: (callback) => {
			sizeCallback = callback;
			return {
				observe: (element, options) => {
					observed.set(element, options);
				},
				unobserve: (element) => {
					observed.delete(element);
				},
			};
		},
		devicePixelRatio: () => pixelRatio,
		hideSyncedImages: () => canHide,
	};
	const resize = (entries: Array<{target: Element; devicePixels?: [number, number]}>) => {
		sizeCallback?.(
			entries.map(
				({target, devicePixels}) =>
					({
						target,
						devicePixelContentBoxSize: devicePixels
							? [{inlineSize: devicePixels[0], blockSize: devicePixels[1]}]
							: undefined,
					}) as unknown as ResizeObserverEntry,
			),
			{} as ResizeObserver,
		);
	};
	return {
		environment,
		observed,
		resize,
		// One screen refresh `ms` later: timers that are due fire, then the animation frame asked for runs.
		advance(ms: number) {
			now += ms;
			const due = timers.filter((timer) => timer.at <= now);
			timers = timers.filter((timer) => timer.at > now);
			for (const timer of due) timer.callback();
			const frame = pendingFrame;
			pendingFrame = null;
			if (frame) {
				framesRun += 1;
				frame(now);
			}
		},
		framesRun: () => framesRun,
		// The window moves to a screen with another pixel ratio.
		setPixelRatio(value: number) {
			pixelRatio = value;
		},
		isIdle: () => pendingFrame === null && timers.length === 0,
		// What the browser does before it next paints: the sizes of a newly shown emoji arrive.
		settle(img: HTMLImageElement, shown: ForkShownEmoji) {
			resize([{target: img}, {target: shown.canvas}]);
		},
	};
}

interface Draw {
	bitmap: unknown;
	x: number;
	y: number;
	width: number;
	height: number;
}

// Where the page puts an image, and where a canvas next to it starts out before any margin: by
// default at the end of the image, on its line. The other cases are what browsers do (measured in
// Chromium and Firefox):
// - `rightToLeft`: the text runs right to left, so the canvas starts out from its right edge, at
//   `canvasStartsAt`; its left margin moves nothing, its right margin does.
// - `centredOn`: the parent centres its content on that point, as a flex box does; the canvas is
//   centred with its margins, so its own size moves it and one margin alone moves it by half.
// - `stuck`: a layout in which margins move nothing at all.
// `scale` is what an ancestor's transform does to everything.
interface Layout {
	at: [number, number];
	size: number;
	canvasStartsAt: [number, number];
	rightToLeft: boolean;
	centredOn: [number, number] | null;
	stuck: boolean;
	scale: number;
}

const layouts = new WeakMap<Element, Layout>();
const unseen = new WeakSet<Element>();
const drawsByCanvas = new WeakMap<Element, Array<Draw>>();

function box(left: number, top: number, width: number, height: number): DOMRect {
	return {left, top, width, height, right: left + width, bottom: top + height, x: left, y: top} as DOMRect;
}

function makeEmoji(layout: Partial<Layout> = {}, parent: HTMLElement = document.body): HTMLImageElement {
	const size = layout.size ?? 24;
	const at = layout.at ?? [100, 50];
	const img = document.createElement('img');
	img.style.width = `${size}px`;
	img.style.height = `${size}px`;
	parent.append(img);
	layouts.set(img, {
		at,
		size,
		canvasStartsAt: layout.canvasStartsAt ?? [at[0] + size, at[1]],
		rightToLeft: layout.rightToLeft ?? false,
		centredOn: layout.centredOn ?? null,
		stuck: layout.stuck ?? false,
		scale: layout.scale ?? 1,
	});
	return img;
}

function draws(shown: ForkShownEmoji): Array<Draw> {
	return drawsByCanvas.get(shown.canvas) ?? [];
}

function frameShown(shown: ForkShownEmoji, frames: ForkEmojiFrames): number {
	return frames.frames.indexOf(draws(shown).at(-1)?.bitmap as ImageBitmap);
}

// Where the canvas lies relative to its image's box, as the page would show it.
function offset(img: HTMLImageElement, shown: ForkShownEmoji): [number, number] {
	const a = img.getBoundingClientRect();
	const b = shown.canvas.getBoundingClientRect();
	return [Math.round((b.left - a.left) * 1000) / 1000, Math.round((b.top - a.top) * 1000) / 1000];
}

beforeEach(() => {
	vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLImageElement) {
		const layout = layouts.get(this);
		if (!layout) return box(0, 0, 0, 0);
		const size = Number.parseFloat(this.style.width) || 0;
		return box(layout.at[0] * layout.scale, layout.at[1] * layout.scale, size * layout.scale, size * layout.scale);
	});
	vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLCanvasElement) {
		const layout = this.previousElementSibling ? layouts.get(this.previousElementSibling) : undefined;
		if (!layout) return box(0, 0, 0, 0);
		const px = (value: string) => Number.parseFloat(value) || 0;
		const [width, height] = [px(this.style.width), px(this.style.height)];
		const margin = layout.stuck
			? {left: 0, right: 0, top: 0, bottom: 0}
			: {
					left: px(this.style.marginLeft),
					right: px(this.style.marginRight),
					top: px(this.style.marginTop),
					bottom: px(this.style.marginBottom),
				};
		let left = layout.canvasStartsAt[0] + margin.left;
		let top = layout.canvasStartsAt[1] + margin.top;
		if (layout.centredOn) {
			left = layout.centredOn[0] - (width + margin.left + margin.right) / 2 + margin.left;
			top = layout.centredOn[1] - (height + margin.top + margin.bottom) / 2 + margin.top;
		} else if (layout.rightToLeft) {
			left = layout.canvasStartsAt[0] - margin.right - width;
		}
		return box(left * layout.scale, top * layout.scale, width * layout.scale, height * layout.scale);
	});
	// Whether anyone can see the emoji: upstream fades some out, with the canvas, through their classes.
	(HTMLCanvasElement.prototype as {checkVisibility?: unknown}).checkVisibility = function (this: HTMLCanvasElement) {
		return !(this.previousElementSibling && unseen.has(this.previousElementSibling));
	};
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		const drawn: Array<Draw> = [];
		drawsByCanvas.set(this, drawn);
		return {
			imageSmoothingEnabled: false,
			imageSmoothingQuality: 'low',
			clearRect: () => {},
			drawImage: (bitmap: unknown, x: number, y: number, width: number, height: number) => {
				drawn.push({bitmap, x, y, width, height});
			},
		};
	} as unknown as HTMLCanvasElement['getContext'];
});

afterEach(() => {
	document.body.replaceChildren();
	delete (HTMLCanvasElement.prototype as {checkVisibility?: unknown}).checkVisibility;
	vi.restoreAllMocks();
});

describe('ForkSyncedEmojiPlayer', () => {
	it('starts the first emoji at its first frame and follows its durations', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const frames = makeFrames([100, 50, 250]);
		const img = makeEmoji();
		const shown = player.show(img, frames)!;
		fake.settle(img, shown);
		expect(frameShown(shown, frames)).toBe(0);
		fake.advance(99);
		expect(frameShown(shown, frames)).toBe(0);
		fake.advance(1);
		expect(frameShown(shown, frames)).toBe(1);
		fake.advance(50);
		expect(frameShown(shown, frames)).toBe(2);
		fake.advance(250);
		expect(frameShown(shown, frames)).toBe(0);
	});

	it('shows an emoji that appears 370 ms later on the same frame as the one already playing', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const leftFrames = makeFrames(WING_DURATIONS);
		const rightFrames = makeFrames(WING_DURATIONS);
		const left = makeEmoji({size: 24});
		const right = makeEmoji({size: 20, at: [300, 50]});
		const leftShown = player.show(left, leftFrames)!;
		fake.settle(left, leftShown);
		for (let time = 0; time < 370; time += 10) fake.advance(10);
		const rightShown = player.show(right, rightFrames)!;
		fake.settle(right, rightShown);
		expect(frameShown(rightShown, rightFrames)).toBe(frameShown(leftShown, leftFrames));
		expect(frameShown(rightShown, rightFrames)).not.toBe(0);
		const seen = new Set<number>();
		for (let time = 0; time < 2500; time += 16) {
			fake.advance(16);
			expect(frameShown(rightShown, rightFrames)).toBe(frameShown(leftShown, leftFrames));
			seen.add(frameShown(leftShown, leftFrames));
		}
		expect(seen.size).toBe(WING_DURATIONS.length);
	});

	it('starts an emoji with another loop length at its first frame while the wings play', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const wingFrames = makeFrames(WING_DURATIONS);
		const sleepyFrames = makeFrames([40, 40, 600]);
		const wing = makeEmoji();
		const sleepy = makeEmoji({at: [300, 50]});
		const wingShown = player.show(wing, wingFrames)!;
		fake.settle(wing, wingShown);
		fake.advance(500);
		const sleepyShown = player.show(sleepy, sleepyFrames)!;
		fake.settle(sleepy, sleepyShown);
		expect(frameShown(sleepyShown, sleepyFrames)).toBe(0);
		expect(frameShown(wingShown, wingFrames)).not.toBe(0);
	});

	it('starts the next emoji at its first frame once none with its loop length is shown, and then rests', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const frames = makeFrames(WING_DURATIONS);
		const first = makeEmoji();
		const firstShown = player.show(first, frames)!;
		fake.settle(first, firstShown);
		fake.advance(400);
		firstShown.hide();
		fake.advance(16);
		expect(fake.isIdle()).toBe(true);
		fake.advance(300);
		const second = makeEmoji({at: [300, 50]});
		const secondShown = player.show(second, frames)!;
		fake.settle(second, secondShown);
		expect(frameShown(secondShown, frames)).toBe(0);
	});

	it('keeps the clock when one emoji replaces another in the same moment', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const frames = makeFrames(WING_DURATIONS);
		const other = makeEmoji();
		const otherShown = player.show(other, frames)!;
		fake.settle(other, otherShown);
		const before = makeEmoji({at: [200, 50]});
		const beforeShown = player.show(before, frames)!;
		fake.settle(before, beforeShown);
		fake.advance(400);
		beforeShown.hide();
		const after = makeEmoji({at: [300, 50]});
		const afterShown = player.show(after, frames)!;
		fake.settle(after, afterShown);
		fake.advance(16);
		expect(frameShown(afterShown, frames)).toBe(frameShown(otherShown, frames));
		expect(frameShown(afterShown, frames)).not.toBe(0);
	});

	it('sleeps until a frame is due instead of waking on every screen refresh', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const frames = makeFrames([500, 500]);
		const img = makeEmoji();
		const shown = player.show(img, frames)!;
		fake.settle(img, shown);
		// A little over two seconds on a 240 Hz screen: the first frame and four changes.
		for (let refresh = 0; refresh < 490; refresh++) fake.advance(1000 / 240);
		expect(draws(shown)).toHaveLength(5);
		expect(fake.framesRun()).toBeLessThan(60);
	});

	it("puts the canvas right after upstream's <img>, out of the flow and out of reach", () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const parent = document.createElement('span');
		parent.append('before ');
		document.body.append(parent);
		const img = makeEmoji({}, parent);
		parent.append(' after');
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		expect(img.nextSibling).toBe(shown.canvas);
		expect(parent.childNodes).toHaveLength(4);
		expect(shown.canvas.hasAttribute(FORK_EMOJI_CANVAS_ATTRIBUTE)).toBe(true);
		expect(shown.canvas.getAttribute('aria-hidden')).toBe('true');
		expect(shown.canvas.style.position).toBe('absolute');
		expect(shown.canvas.style.pointerEvents).toBe('none');
		expect(shown.canvas.style.left).toBe('');
		expect(shown.canvas.style.top).toBe('');
		expect(player.show(img, makeFrames(WING_DURATIONS))).toBeNull();
	});

	it("dresses the canvas in the image's classes, so that upstream's rules fade and dim it like the image", () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji();
		img.className = 'statusEmoji animatedEmoji';
		img.style.opacity = '0.5';
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		fake.settle(img, shown);
		expect(shown.canvas.className).toBe('statusEmoji animatedEmoji');
		expect(shown.canvas.style.opacity).toBe('0.5');
		// Whatever those classes say, the canvas stays out of the flow, where it was measured to.
		expect(shown.canvas.style.position).toBe('absolute');
		expect(shown.canvas.style.width).toBe('24px');
		expect(shown.canvas.style.minHeight).toBe('0');
		img.className = 'statusEmoji';
		img.style.opacity = '';
		shown.restyle();
		expect(shown.canvas.className).toBe('statusEmoji');
		expect(shown.canvas.style.opacity).toBe('');
	});

	it("hides upstream's <img> once a frame is on the canvas, and shows it again afterwards", () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji();
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		expect(draws(shown)).toHaveLength(0);
		expect(img.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(false);
		fake.settle(img, shown);
		expect(draws(shown)).toHaveLength(1);
		expect(img.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(true);
		expect(img.getAttribute('style')).not.toContain('opacity');
		shown.hide();
		expect(img.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(false);
		expect(shown.canvas.isConnected).toBe(false);
		expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
		expect(fake.observed.size).toBe(0);
	});

	it("leaves upstream's <img> showing while it has no box to draw on", () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji({size: 0});
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		fake.settle(img, shown);
		fake.advance(100);
		expect(draws(shown)).toHaveLength(0);
		expect(img.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(false);
	});

	it('does nothing where the page cannot hide the <img>', () => {
		const fake = createFakeEnvironment({canHide: false});
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji();
		expect(player.show(img, makeFrames(WING_DURATIONS))).toBeNull();
		expect(document.body.querySelectorAll('canvas')).toHaveLength(0);
		expect(fake.isIdle()).toBe(true);
	});

	it("moves the canvas onto the image's box, with a pixel for every device pixel", () => {
		const fake = createFakeEnvironment({ratio: 1.25});
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		// The canvas starts out at the end of the image and 3.5 px above it.
		const img = makeEmoji({size: 20, at: [110, 54], canvasStartsAt: [130, 50.5]});
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		fake.settle(img, shown);
		expect(shown.canvas.style.marginLeft).toBe('-20px');
		expect(shown.canvas.style.marginRight).toBe('20px');
		expect(shown.canvas.style.marginTop).toBe('3.5px');
		expect(shown.canvas.style.marginBottom).toBe('-3.5px');
		expect(shown.canvas.style.width).toBe('20px');
		expect(shown.canvas.style.height).toBe('20px');
		expect(offset(img, shown)).toEqual([0, 0]);
		expect([shown.canvas.width, shown.canvas.height]).toEqual([25, 25]);
		expect(draws(shown).at(-1)).toMatchObject({x: 0, y: 0, width: 25, height: 25});
	});

	it('lands on the image at once where the parent centres its content', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		// A reaction: the emoji sits left of the count, and the two are centred together.
		const img = makeEmoji({size: 20, at: [100, 204], centredOn: [124, 214]});
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		fake.settle(img, shown);
		expect(offset(img, shown)).toEqual([0, 0]);
		expect(shown.canvas.style.marginLeft).toBe('-14px');
		expect(shown.canvas.style.marginRight).toBe('14px');
		// The count grows a digit: the emoji moves left, and the canvas follows in one step.
		layouts.get(img)!.at = [96, 204];
		fake.advance(16);
		expect(offset(img, shown)).toEqual([0, 0]);
		expect(shown.canvas.style.marginLeft).toBe('-18px');
	});

	it('lands on the image at once where the text runs right to left, and stays there', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		// A message that starts with Hebrew: the image is left of where the canvas starts out.
		const img = makeEmoji({size: 24, at: [300, 50], canvasStartsAt: [300, 50], rightToLeft: true});
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		fake.settle(img, shown);
		expect(offset(img, shown)).toEqual([0, 0]);
		expect(shown.canvas.style.marginLeft).toBe('24px');
		expect(shown.canvas.style.marginRight).toBe('-24px');
		for (let time = 0; time < 1000; time += 16) fake.advance(16);
		expect(offset(img, shown)).toEqual([0, 0]);
		expect(shown.canvas.style.marginLeft).toBe('24px');
	});

	it('gives an image back to upstream where no move brings the canvas onto it', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji({size: 24, at: [100, 50], canvasStartsAt: [140, 50], stuck: true});
		const onLost = vi.fn();
		const shown = player.show(img, makeFrames(WING_DURATIONS), {
			onLost: () => {
				onLost();
				shown.hide();
			},
		})!;
		fake.settle(img, shown);
		for (let time = 0; time < 2000 && onLost.mock.calls.length === 0; time += 16) fake.advance(16);
		expect(onLost).toHaveBeenCalledTimes(1);
		expect(shown.canvas.isConnected).toBe(false);
		expect(img.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(false);
		// Tried a few times, not for ever.
		expect(Math.abs(Number.parseFloat(shown.canvas.style.marginLeft))).toBeLessThanOrEqual(40 * 8);
		fake.advance(16);
		expect(fake.isIdle()).toBe(true);
		// Without anyone to tell, the player takes the canvas away itself.
		const other = makeEmoji({size: 24, at: [100, 90], canvasStartsAt: [140, 90], stuck: true});
		const otherShown = player.show(other, makeFrames(WING_DURATIONS))!;
		fake.settle(other, otherShown);
		for (let time = 0; time < 2000; time += 16) fake.advance(16);
		expect(otherShown.canvas.isConnected).toBe(false);
	});

	it('measures through an ancestor that is being scaled', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji({size: 20, at: [110, 54], canvasStartsAt: [130, 50], scale: 0.5});
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		fake.settle(img, shown);
		expect(shown.canvas.style.marginLeft).toBe('-20px');
		expect(shown.canvas.style.marginTop).toBe('4px');
		expect([shown.canvas.width, shown.canvas.height]).toEqual([20, 20]);
	});

	it("covers the image's content box when the image has padding and a border", () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji({size: 24, at: [100, 50], canvasStartsAt: [100, 50]});
		img.style.boxSizing = 'border-box';
		img.style.padding = '3px';
		img.style.border = '1px solid';
		img.style.borderRadius = '4px';
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		fake.settle(img, shown);
		expect(shown.canvas.style.width).toBe('16px');
		expect(shown.canvas.style.height).toBe('16px');
		expect(offset(img, shown)).toEqual([4, 4]);
		expect(shown.canvas.style.borderRadius).toBe('4px');
	});

	it('puts the canvas back when the page moves the image without resizing it', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji({size: 24, at: [100, 50], canvasStartsAt: [124, 50]});
		const shown = player.show(img, makeFrames([500, 500]))!;
		fake.settle(img, shown);
		expect(offset(img, shown)).toEqual([0, 0]);
		fake.advance(16);
		// The text before the emoji wraps: the image goes to the next line, the canvas's start does not.
		layouts.get(img)!.at = [10, 72];
		expect(offset(img, shown)).not.toEqual([0, 0]);
		// Long before the next frame is due.
		for (let time = 0; time < 300; time += 16) fake.advance(16);
		expect(offset(img, shown)).toEqual([0, 0]);
		expect(draws(shown)).toHaveLength(1);
	});

	it('leaves an emoji nobody can see to upstream, without a clock, until it can be seen', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const frames = makeFrames(WING_DURATIONS);
		// A status emoji that upstream only shows while its row is hovered.
		const status = makeEmoji({size: 18});
		unseen.add(status);
		const statusShown = player.show(status, frames)!;
		fake.settle(status, statusShown);
		for (let time = 0; time < 2000; time += 1000 / 60) fake.advance(1000 / 60);
		expect(draws(statusShown)).toHaveLength(0);
		expect(status.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(false);
		// It only looks now and then whether that changed.
		expect(fake.framesRun()).toBeLessThan(12);
		// A wing that appears meanwhile starts at its first frame: the hidden one held no clock.
		const wing = makeEmoji({at: [300, 50]});
		const wingShown = player.show(wing, frames)!;
		fake.settle(wing, wingShown);
		expect(frameShown(wingShown, frames)).toBe(0);
		for (let time = 0; time < 400; time += 16) fake.advance(16);
		// The row is hovered: within a moment the status emoji plays, in step with the wing.
		unseen.delete(status);
		for (let time = 0; time < 300; time += 16) fake.advance(16);
		expect(status.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(true);
		expect(frameShown(statusShown, frames)).toBe(frameShown(wingShown, frames));
		// The pointer leaves: the canvas is wiped and the image is upstream's again.
		unseen.add(status);
		for (let time = 0; time < 300; time += 16) fake.advance(16);
		expect(status.hasAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE)).toBe(false);
		const drawn = draws(statusShown).length;
		for (let time = 0; time < 300; time += 16) fake.advance(16);
		expect(draws(statusShown)).toHaveLength(drawn);
	});

	it('follows the screen to another pixel ratio where nothing reports device pixels', () => {
		const fake = createFakeEnvironment({ratio: 1});
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji({size: 24});
		const shown = player.show(img, makeFrames([500, 500]))!;
		fake.settle(img, shown);
		fake.advance(16);
		expect([shown.canvas.width, shown.canvas.height]).toEqual([24, 24]);
		fake.setPixelRatio(2);
		for (let time = 0; time < 300; time += 16) fake.advance(16);
		expect([shown.canvas.width, shown.canvas.height]).toEqual([48, 48]);
		expect(draws(shown).at(-1)).toMatchObject({width: 48, height: 48});
	});

	it('follows a change of size or zoom, draws the frame again, and says how large the emoji is', () => {
		const fake = createFakeEnvironment({ratio: 2});
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const frames = makeFrames(WING_DURATIONS);
		const img = makeEmoji({size: 20});
		const onDevicePixels = vi.fn();
		const shown = player.show(img, frames, {onDevicePixels})!;
		fake.settle(img, shown);
		expect([shown.canvas.width, shown.canvas.height]).toEqual([40, 40]);
		expect(fake.observed.get(shown.canvas)).toEqual({box: 'device-pixel-content-box'});
		expect(onDevicePixels).toHaveBeenLastCalledWith(40);
		// The box ends between two pixels: the observer's count is the exact one.
		fake.resize([{target: shown.canvas, devicePixels: [41, 40]}]);
		expect([shown.canvas.width, shown.canvas.height]).toEqual([41, 40]);
		expect(draws(shown)).toHaveLength(2);
		expect(frameShown(shown, frames)).toBe(0);
		expect(onDevicePixels).toHaveBeenLastCalledWith(41);
		// The image grows: the canvas takes its new box and its pixels follow.
		img.style.width = '30px';
		img.style.height = '30px';
		fake.resize([{target: img}]);
		expect(shown.canvas.style.width).toBe('30px');
		fake.resize([{target: shown.canvas, devicePixels: [60, 60]}]);
		expect([shown.canvas.width, shown.canvas.height]).toEqual([60, 60]);
		expect(onDevicePixels).toHaveBeenLastCalledWith(60);
	});

	it('does not believe a device pixel count given in CSS pixels, as under device emulation', () => {
		const fake = createFakeEnvironment({ratio: 2});
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = makeEmoji({size: 24});
		const onDevicePixels = vi.fn();
		const shown = player.show(img, makeFrames(WING_DURATIONS), {onDevicePixels})!;
		fake.resize([{target: img}, {target: shown.canvas, devicePixels: [24, 24]}]);
		expect([shown.canvas.width, shown.canvas.height]).toEqual([48, 48]);
		expect(onDevicePixels).toHaveBeenLastCalledWith(48);
	});

	it("draws a frame that is not square the way upstream's object-fit shows the image", () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const lastDraw = (fit: string) => {
			const img = makeEmoji({size: 24});
			img.style.objectFit = fit;
			const shown = player.show(img, makeFrames(WING_DURATIONS, 32, 20))!;
			fake.settle(img, shown);
			return draws(shown).at(-1);
		};
		expect(lastDraw('contain')).toMatchObject({x: 0, y: 5, width: 24, height: 15});
		expect(lastDraw('fill')).toMatchObject({x: 0, y: 0, width: 24, height: 24});
		expect(lastDraw('cover')).toMatchObject({x: -7, y: 0, width: 38, height: 24});
	});
});

describe('forkEmojiCanvasStaysWithImage', () => {
	function nest(...styles: Array<Partial<CSSStyleDeclaration>>): HTMLImageElement {
		let parent: HTMLElement = document.body;
		for (const style of styles) {
			const element = document.createElement('div');
			Object.assign(element.style, style);
			parent.append(element);
			parent = element;
		}
		return makeEmoji({}, parent);
	}

	it('is true where a positioned box comes before any box that scrolls or clips', () => {
		expect(forkEmojiCanvasStaysWithImage(nest({overflowY: 'auto'}, {position: 'relative'}, {}))).toBe(true);
		expect(forkEmojiCanvasStaysWithImage(nest({position: 'relative', overflowX: 'hidden', overflowY: 'hidden'}))).toBe(
			true,
		);
		expect(forkEmojiCanvasStaysWithImage(nest({overflowY: 'auto'}, {transform: 'translateZ(0)'}, {}))).toBe(true);
		expect(forkEmojiCanvasStaysWithImage(nest({}, {}))).toBe(true);
	});

	it('is false where the image would scroll away or be cut off without its canvas', () => {
		expect(forkEmojiCanvasStaysWithImage(nest({position: 'relative'}, {overflowY: 'auto'}, {}))).toBe(false);
		expect(forkEmojiCanvasStaysWithImage(nest({overflowX: 'hidden', overflowY: 'hidden'}))).toBe(false);
	});

	it("makes the image's parent what the canvas belongs to there, for as long as it holds one", () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const first = nest({position: 'relative'}, {overflowY: 'auto'}, {});
		const parent = first.parentElement!;
		const second = makeEmoji({at: [300, 50]}, parent);
		const firstShown = player.show(first, makeFrames(WING_DURATIONS))!;
		const secondShown = player.show(second, makeFrames(WING_DURATIONS))!;
		expect(parent.hasAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE)).toBe(true);
		firstShown.hide();
		expect(parent.hasAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE)).toBe(true);
		secondShown.hide();
		expect(parent.hasAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE)).toBe(false);
		const elsewhere = nest({overflowY: 'auto'}, {position: 'relative'}, {});
		player.show(elsewhere, makeFrames(WING_DURATIONS));
		expect(elsewhere.parentElement!.hasAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE)).toBe(false);
	});

	it('looks past a parent that has no box of its own', () => {
		const fake = createFakeEnvironment();
		const player = new ForkSyncedEmojiPlayer(fake.environment);
		const img = nest({position: 'relative'}, {overflowY: 'auto'}, {}, {display: 'contents'});
		const boxless = img.parentElement!;
		const shown = player.show(img, makeFrames(WING_DURATIONS))!;
		expect(boxless.hasAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE)).toBe(false);
		expect(boxless.parentElement!.hasAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE)).toBe(true);
		shown.hide();
		expect(boxless.parentElement!.hasAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE)).toBe(false);
		// Positioned or clipping, an element without a box does neither.
		expect(forkEmojiCanvasStaysWithImage(nest({overflowY: 'auto'}, {display: 'contents', position: 'relative'}))).toBe(
			false,
		);
	});
});
