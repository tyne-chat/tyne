// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	createForkEmojiTimeline,
	ForkSyncedEmojiClocks,
	forkEmojiFrameAt,
	forkEmojiFrameDurationMs,
	forkEmojiMsToNextFrame,
} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import {describe, expect, it} from 'vitest';

// The wings of tyne-chat/tyne#91: 34 frames of 20, 30 and 70 ms, 1060 ms in all.
const WING_DURATIONS = [
	...Array.from({length: 12}, () => 20),
	...Array.from({length: 18}, () => 30),
	...Array.from({length: 4}, () => 70),
];

describe('forkEmojiFrameDurationMs', () => {
	it('shows frames of 10 ms or less, or without a duration, for 100 ms as browsers do', () => {
		expect(forkEmojiFrameDurationMs(0)).toBe(100);
		expect(forkEmojiFrameDurationMs(10_000)).toBe(100);
		expect(forkEmojiFrameDurationMs(null)).toBe(100);
		expect(forkEmojiFrameDurationMs(undefined)).toBe(100);
		expect(forkEmojiFrameDurationMs(20_000)).toBe(20);
		expect(forkEmojiFrameDurationMs(70_000)).toBe(70);
	});
});

describe('forkEmojiFrameAt', () => {
	const timeline = createForkEmojiTimeline([100, 50, 250]);

	it('gives the frame due at a time, and wraps around at the end of the loop', () => {
		expect(timeline.loopMs).toBe(400);
		expect(timeline.loopKey).toBe(400);
		expect(forkEmojiFrameAt(timeline, 0)).toBe(0);
		expect(forkEmojiFrameAt(timeline, 99.9)).toBe(0);
		expect(forkEmojiFrameAt(timeline, 100)).toBe(1);
		expect(forkEmojiFrameAt(timeline, 149)).toBe(1);
		expect(forkEmojiFrameAt(timeline, 150)).toBe(2);
		expect(forkEmojiFrameAt(timeline, 399)).toBe(2);
		expect(forkEmojiFrameAt(timeline, 400)).toBe(0);
		expect(forkEmojiFrameAt(timeline, 4 * 400 + 120)).toBe(1);
	});

	it('shows the first frame for a time before the clock started', () => {
		expect(forkEmojiFrameAt(timeline, -5)).toBe(0);
	});

	it('shows the only frame of a still image', () => {
		expect(forkEmojiFrameAt(createForkEmojiTimeline([100]), 250)).toBe(0);
	});

	it('gives two timelines with the same durations the same frame at every moment', () => {
		const left = createForkEmojiTimeline(WING_DURATIONS);
		const right = createForkEmojiTimeline([...WING_DURATIONS]);
		expect(left.loopMs).toBe(1060);
		for (let time = 0; time < 2000; time += 7) {
			expect(forkEmojiFrameAt(right, time)).toBe(forkEmojiFrameAt(left, time));
		}
	});
});

describe('forkEmojiMsToNextFrame', () => {
	it('says how long the frame shown stays, on every lap', () => {
		const timeline = createForkEmojiTimeline([100, 50, 250]);
		expect(forkEmojiMsToNextFrame(timeline, 0)).toBe(100);
		expect(forkEmojiMsToNextFrame(timeline, 99)).toBe(1);
		expect(forkEmojiMsToNextFrame(timeline, 100)).toBe(50);
		expect(forkEmojiMsToNextFrame(timeline, 160)).toBe(240);
		expect(forkEmojiMsToNextFrame(timeline, 3 * 400 + 120)).toBe(30);
	});

	it('never ends for an emoji with one frame', () => {
		expect(forkEmojiMsToNextFrame(createForkEmojiTimeline([100]), 250)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe('ForkSyncedEmojiClocks', () => {
	it('starts a clock at the first frame shown, and later emoji with the loop length join it', () => {
		const clocks = new ForkSyncedEmojiClocks();
		clocks.show(1060);
		expect(clocks.elapsedAt(1060, 5000)).toBe(0);
		clocks.endOfFrame();
		clocks.show(1060);
		expect(clocks.elapsedAt(1060, 5370)).toBe(370);
	});

	it('keeps one clock per loop length', () => {
		const clocks = new ForkSyncedEmojiClocks();
		clocks.show(1060);
		clocks.elapsedAt(1060, 1000);
		clocks.show(600);
		expect(clocks.elapsedAt(600, 1300)).toBe(0);
		expect(clocks.elapsedAt(1060, 1300)).toBe(300);
	});

	it('drops a clock when none of its emoji is shown at the end of a frame', () => {
		const clocks = new ForkSyncedEmojiClocks();
		clocks.show(1060);
		clocks.elapsedAt(1060, 1000);
		clocks.hide(1060);
		clocks.endOfFrame();
		expect(clocks.size).toBe(0);
		clocks.show(1060);
		expect(clocks.elapsedAt(1060, 2500)).toBe(0);
	});

	it('keeps the clock when one emoji replaces another within a frame', () => {
		const clocks = new ForkSyncedEmojiClocks();
		clocks.show(1060);
		clocks.elapsedAt(1060, 1000);
		clocks.hide(1060);
		clocks.show(1060);
		clocks.endOfFrame();
		expect(clocks.elapsedAt(1060, 1200)).toBe(200);
	});

	it('resets each loop length on its own', () => {
		const clocks = new ForkSyncedEmojiClocks();
		clocks.show(1060);
		clocks.show(600);
		clocks.elapsedAt(1060, 1000);
		clocks.elapsedAt(600, 1000);
		clocks.hide(600);
		clocks.endOfFrame();
		expect(clocks.elapsedAt(1060, 1500)).toBe(500);
		clocks.show(600);
		expect(clocks.elapsedAt(600, 1500)).toBe(0);
	});
});
