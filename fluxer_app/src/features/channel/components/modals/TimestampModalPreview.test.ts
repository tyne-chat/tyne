// SPDX-License-Identifier: AGPL-3.0-or-later

import {DateTime} from 'luxon';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/user/utils/LocaleUtils', () => ({
	getCurrentLocale: () => 'en-US',
	getFormattingLocale: () => 'en-US',
}));
vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {timeFormat: 0, timestampFormat: 0},
}));

const {formatTimestamp} = await import('@app/features/messaging/utils/markdown/DateFormatter');
const {TimestampStyle} = await import('@app/features/messaging/utils/markdown/parser/Enums');
const {formatRelativeGap, insertedEpoch, resolveTimestampText} = await import(
	'@app/features/channel/components/modals/TimestampModalPreview'
);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeGap (tyne-chat/tyne#389)', () => {
	let now: number;
	beforeEach(() => {
		// A whole second ahead of the real clock: upstream's formatter keeps its "now" for 250 ms.
		vi.useFakeTimers({toFake: ['Date']});
		now = Math.ceil(Date.now() / SECOND) * SECOND + SECOND;
		vi.setSystemTime(now);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("words every gap as upstream's formatter does from its own clock", () => {
		const i18n = {locale: 'en-US'} as Parameters<typeof formatTimestamp>[2];
		const gaps = [
			0,
			10 * SECOND,
			59 * SECOND,
			MINUTE,
			10 * MINUTE,
			59 * MINUTE + 59 * SECOND,
			HOUR,
			HOUR + 50 * MINUTE,
			23 * HOUR + 59 * MINUTE,
			DAY,
			6 * DAY,
			7 * DAY,
			29 * DAY,
			30 * DAY,
			364 * DAY,
			365 * DAY,
			800 * DAY,
		];
		for (const gap of [...gaps, ...gaps.filter((value) => value > 0).map((value) => -value)]) {
			const upstream = formatTimestamp((now + gap) / SECOND, TimestampStyle.RelativeTime, i18n);
			expect(formatRelativeGap(gap), `gap ${gap} ms`).toBe(upstream);
		}
	});
});

describe('resolveTimestampText (tyne-chat/tyne#389)', () => {
	const anchorMs = Date.UTC(2026, 10, 21, 18, 0, 0, 400);

	it('counts a relative phrase from the moment given', () => {
		const resolved = resolveTimestampText('in 10 minutes', 'UTC', anchorMs);
		expect(resolved?.relative).toBe(true);
		expect(resolved?.anchorMs).toBe(anchorMs);
		expect(resolved?.dateTime.toMillis()).toBe(anchorMs + 10 * MINUTE);
	});

	it('reads "now" as relative too', () => {
		const resolved = resolveTimestampText('now', 'UTC', anchorMs);
		expect(resolved?.relative).toBe(true);
		expect(resolved?.dateTime.toMillis()).toBe(anchorMs);
	});

	it('reads a time of day as a fixed time in the zone given', () => {
		const resolved = resolveTimestampText('tomorrow at 3pm', 'Europe/Berlin', anchorMs);
		expect(resolved?.relative).toBe(false);
		expect(resolved?.dateTime.toISO()).toBe('2026-11-22T15:00:00.000+01:00');
	});

	it('says nothing for empty text or text it cannot read', () => {
		expect(resolveTimestampText('  ', 'UTC', anchorMs)).toBeNull();
		expect(resolveTimestampText('purple', 'UTC', anchorMs)).toBeNull();
	});
});

describe('insertedEpoch (tyne-chat/tyne#389)', () => {
	it('rounds a time up to the next whole second', () => {
		expect(insertedEpoch(DateTime.fromMillis(1_700_000_000_400))).toBe(1_700_000_001);
	});

	it('keeps a whole second as it is', () => {
		expect(insertedEpoch(DateTime.fromMillis(1_700_000_000_000))).toBe(1_700_000_000);
	});
});
