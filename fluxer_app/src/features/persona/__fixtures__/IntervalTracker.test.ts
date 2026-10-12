// SPDX-License-Identifier: AGPL-3.0-or-later

import {trackIntervals} from '@app/features/persona/__fixtures__/IntervalTracker';
import {describe, expect, it, vi} from 'vitest';

function createHost() {
	return {setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval};
}

async function wait(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('trackIntervals', () => {
	it('stops a repeating timer that nobody stopped', async () => {
		const host = createHost();
		const tracker = trackIntervals(host);
		const tick = vi.fn();
		host.setInterval(tick, 5);
		await wait(30);
		expect(tick).toHaveBeenCalled();

		expect(tracker.clearLeftovers()).toBe(1);
		const ticksWhenStopped = tick.mock.calls.length;
		await wait(30);
		expect(tick).toHaveBeenCalledTimes(ticksWhenStopped);
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
