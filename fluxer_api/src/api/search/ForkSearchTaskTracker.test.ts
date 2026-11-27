import {afterEach, describe, expect, it, vi} from 'vitest';

import {drainSearchTasks, enableSearchTaskTracking, trackSearchTask} from './SearchTaskTracker';

describe('SearchTaskTracker drainSearchTasks timeout cleanup', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('clears its deadline timeout once all pending search tasks settle', async () => {
		vi.useFakeTimers();
		enableSearchTaskTracking();

		let resolveTask!: () => void;
		const task = new Promise<void>((resolve) => {
			resolveTask = resolve;
		});
		trackSearchTask(task);

		const drainPromise = drainSearchTasks();
		expect(vi.getTimerCount()).toBe(1);

		resolveTask();
		await drainPromise;

		expect(vi.getTimerCount()).toBe(0);
	});
});
