// SPDX-License-Identifier: AGPL-3.0-or-later

interface IntervalHost {
	setInterval: typeof globalThis.setInterval;
	clearInterval: typeof globalThis.clearInterval;
}

interface IntervalTracker {
	clearLeftovers(): number;
}

// Records every repeating timer started through `host` so that the ones nobody stopped can
// be stopped in one go. Stores such as `Idle` start a timer when they are imported and read
// `window` on every tick. A test file that runs in a simulated browser must stop them before
// that browser is torn down, or a late tick fails the whole run with "window is not defined".
export function trackIntervals(host: IntervalHost): IntervalTracker {
	const startInterval = host.setInterval;
	const stopInterval = host.clearInterval;
	const running = new Set<unknown>();
	host.setInterval = ((...args: Parameters<typeof globalThis.setInterval>) => {
		const id = startInterval(...args);
		running.add(id);
		return id;
	}) as typeof globalThis.setInterval;
	host.clearInterval = ((id: Parameters<typeof globalThis.clearInterval>[0]) => {
		running.delete(id);
		stopInterval(id);
	}) as typeof globalThis.clearInterval;
	return {
		clearLeftovers(): number {
			const stopped = running.size;
			for (const id of running) {
				stopInterval(id as Parameters<typeof globalThis.clearInterval>[0]);
			}
			running.clear();
			return stopped;
		},
	};
}
