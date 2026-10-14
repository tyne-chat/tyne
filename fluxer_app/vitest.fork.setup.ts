// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterAll, vi} from 'vitest';
import {trackIntervals} from './src/features/persona/__fixtures__/IntervalTracker';

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
