// SPDX-License-Identifier: AGPL-3.0-or-later

import {trackIntervals} from '@app/features/persona/__fixtures__/IntervalTracker';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

function createHost() {
	return {setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval};
}

describe('trackIntervals', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('stops a repeating timer that nobody stopped', () => {
		const host = createHost();
		const tracker = trackIntervals(host);
		const tick = vi.fn();
		host.setInterval(tick, 5);
		vi.advanceTimersByTime(30);
		expect(tick).toHaveBeenCalledTimes(6);

		expect(tracker.clearLeftovers()).toBe(1);
		vi.advanceTimersByTime(30);
		expect(tick).toHaveBeenCalledTimes(6);
	});

	it('does not count a timer its owner already stopped', () => {
		const host = createHost();
		const tracker = trackIntervals(host);
		const id = host.setInterval(() => undefined, 1000);
		host.clearInterval(id);

		expect(tracker.clearLeftovers()).toBe(0);
	});

	it('has nothing left after the leftovers are stopped', () => {
		const host = createHost();
		const tracker = trackIntervals(host);
		host.setInterval(() => undefined, 1000);
		host.setInterval(() => undefined, 1000);

		expect(tracker.clearLeftovers()).toBe(2);
		expect(tracker.clearLeftovers()).toBe(0);
	});
});
