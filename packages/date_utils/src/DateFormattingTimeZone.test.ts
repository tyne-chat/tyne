// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the time zone argument the fork added to getFormattedDateTimeWithSeconds.

import {describe, expect, it} from 'vitest';
import {getFormattedDateTimeWithSeconds} from './DateFormatting';

const NEW_YEAR_UTC = new Date('2026-01-01T00:30:15Z');

describe('getFormattedDateTimeWithSeconds in a given time zone', () => {
	it('shows the date and time of that zone', () => {
		expect(getFormattedDateTimeWithSeconds(NEW_YEAR_UTC, 'en-US', false, 'America/Los_Angeles')).toBe(
			'Wednesday, December 31, 2025 16:30:15',
		);
		expect(getFormattedDateTimeWithSeconds(NEW_YEAR_UTC, 'en-US', false, 'Pacific/Auckland')).toBe(
			'Thursday, January 1, 2026 13:30:15',
		);
	});

	it('falls back to the runtime zone for a zone it does not know', () => {
		expect(getFormattedDateTimeWithSeconds(NEW_YEAR_UTC, 'en-US', false, 'Mars/Olympus_Mons')).toBe(
			getFormattedDateTimeWithSeconds(NEW_YEAR_UTC, 'en-US', false),
		);
	});
});
