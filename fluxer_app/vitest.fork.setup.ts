// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterAll} from 'vitest';
import {trackIntervals} from './src/features/persona/__fixtures__/IntervalTracker';

// Stops every repeating timer a test file leaves running, before its environment is torn
// down. See `trackIntervals` for why.
const intervals = trackIntervals(globalThis);

afterAll(() => {
	intervals.clearLeftovers();
});
