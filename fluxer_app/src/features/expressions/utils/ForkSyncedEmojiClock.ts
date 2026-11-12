// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the timing that keeps animated custom emoji in step (tyne-chat/tyne#612), as the mobile app
// does it (tyne-chat/tyne#91, tyne-mobile `lib/core/media/fork_synced_emoji_timeline.dart` and
// `fork_synced_emoji_clock.dart`). Every animated emoji shows the frame that one clock gives for its
// loop length, so a left and a right wing (34 frames, 1060 ms each) always show the same frame,
// however far apart they were loaded. A clock starts at the first frame an emoji with that loop length
// is shown, and is dropped when none is shown at the end of a frame, so the next one starts at its
// first frame again. Emoji with other loop lengths cannot stay in step anyway, so each loop length
// keeps its own clock and nothing jumps when another one appears.

// Browsers show frames of 10 ms or less for 100 ms (Chromium and Firefox), and so does the mobile app.
const SHORTEST_FRAME_MS = 10;
const SHORT_FRAME_SHOWN_FOR_MS = 100;

export function forkEmojiFrameDurationMs(durationMicroseconds: number | null | undefined): number {
	const durationMs = durationMicroseconds == null ? 0 : durationMicroseconds / 1000;
	return durationMs <= SHORTEST_FRAME_MS ? SHORT_FRAME_SHOWN_FOR_MS : durationMs;
}

export interface ForkEmojiTimeline {
	readonly loopMs: number;
	readonly loopKey: number;
	readonly frameEnds: ReadonlyArray<number>;
}

export function createForkEmojiTimeline(frameDurationsMs: ReadonlyArray<number>): ForkEmojiTimeline {
	const frameEnds: Array<number> = [];
	let loopMs = 0;
	for (const duration of frameDurationsMs) {
		loopMs += duration;
		frameEnds.push(loopMs);
	}
	return {loopMs, loopKey: Math.round(loopMs), frameEnds};
}

export function forkEmojiFrameAt(timeline: ForkEmojiTimeline, elapsedMs: number): number {
	const {loopMs, frameEnds} = timeline;
	if (frameEnds.length <= 1 || loopMs <= 0) {
		return 0;
	}
	const position = Math.max(0, elapsedMs) % loopMs;
	let low = 0;
	let high = frameEnds.length - 1;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (frameEnds[middle] > position) {
			high = middle;
		} else {
			low = middle + 1;
		}
	}
	return low;
}

// How long the frame shown at `elapsedMs` stays, so that nothing needs to wake up before it changes.
export function forkEmojiMsToNextFrame(timeline: ForkEmojiTimeline, elapsedMs: number): number {
	const {loopMs, frameEnds} = timeline;
	if (frameEnds.length <= 1 || loopMs <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	return frameEnds[forkEmojiFrameAt(timeline, elapsedMs)] - (Math.max(0, elapsedMs) % loopMs);
}

interface ForkEmojiClock {
	shown: number;
	origin: number | null;
}

export class ForkSyncedEmojiClocks {
	private readonly clocks = new Map<number, ForkEmojiClock>();

	show(loopKey: number): void {
		const clock = this.clocks.get(loopKey);
		if (clock) {
			clock.shown += 1;
		} else {
			this.clocks.set(loopKey, {shown: 1, origin: null});
		}
	}

	hide(loopKey: number): void {
		const clock = this.clocks.get(loopKey);
		if (clock) {
			clock.shown = Math.max(0, clock.shown - 1);
		}
	}

	elapsedAt(loopKey: number, now: number): number {
		let clock = this.clocks.get(loopKey);
		if (!clock) {
			clock = {shown: 0, origin: null};
			this.clocks.set(loopKey, clock);
		}
		clock.origin ??= now;
		return Math.max(0, now - clock.origin);
	}

	endOfFrame(): void {
		for (const [loopKey, clock] of this.clocks) {
			if (clock.shown === 0) {
				this.clocks.delete(loopKey);
			}
		}
	}

	get size(): number {
		return this.clocks.size;
	}
}
