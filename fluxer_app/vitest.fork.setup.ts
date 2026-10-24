// SPDX-License-Identifier: AGPL-3.0-or-later

import 'fake-indexeddb/auto';
import {afterAll, vi} from 'vitest';
import {trackIntervals} from './src/features/persona/__fixtures__/IntervalTracker';

// What upstream's vitest.setup.ts provided until upstream removed it with its web tests (2026-10-21).

interface TestLockManager {
	request<Result>(name: string, operation: () => Promise<Result>): Promise<Result>;
}

function createTestLockManager(): TestLockManager {
	const tails = new Map<string, Promise<void>>();
	return {
		request<Result>(name: string, operation: () => Promise<Result>): Promise<Result> {
			const result = (tails.get(name) ?? Promise.resolve()).then(operation);
			const tail = result.then(
				() => undefined,
				() => undefined,
			);
			tails.set(name, tail);
			void tail.then(() => {
				if (tails.get(name) === tail) {
					tails.delete(name);
				}
			});
			return result;
		},
	};
}

if (typeof window !== 'undefined' && window.localStorage === undefined && typeof Storage === 'function') {
	Object.defineProperty(window, 'localStorage', {value: new Storage(), configurable: true, writable: true});
}

if (typeof navigator !== 'undefined' && navigator.locks == null) {
	Object.defineProperty(navigator, 'locks', {value: createTestLockManager(), configurable: true, writable: true});
}

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (d: {message?: string}) => d?.message ?? '', locale: 'en'}}),
}));

// Stops every repeating timer a test file leaves running, before its environment is torn
// down. See `trackIntervals` for why.
const intervals = trackIntervals(globalThis);

afterAll(() => {
	intervals.clearLeftovers();
});
