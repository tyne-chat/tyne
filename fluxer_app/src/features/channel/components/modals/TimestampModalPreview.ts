// SPDX-License-Identifier: AGPL-3.0-or-later

import {getRelativeTimeFormat} from '@app/features/ui/utils/RelativeDayLabels';
import {getCurrentLocale} from '@app/features/user/utils/LocaleUtils';
import {MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND} from '@fluxer/date_utils/src/DateConstants';
import * as chrono from 'chrono-node';
import {DateTime} from 'luxon';

/** The timestamp dialog's text box, worked out against one moment (tyne-chat/tyne#389). */
export interface ResolvedTimestampText {
	dateTime: DateTime;
	/** Counted from the moment it was worked out ("in 10 minutes", "now"), so it moves with the clock. */
	relative: boolean;
	/** The moment it was worked out against. */
	anchorMs: number;
}

/**
 * What the text says at `anchorMs`, in `timeZone`; null while it says nothing yet. The dialog works
 * it out again every second and once more on Insert: "in 10 minutes" means ten minutes after the
 * time is inserted, not after it was typed.
 */
export function resolveTimestampText(text: string, timeZone: string, anchorMs: number): ResolvedTimestampText | null {
	if (!text.trim()) {
		return null;
	}
	try {
		const anchor = DateTime.fromMillis(anchorMs, {zone: timeZone});
		const parsedResults = chrono.parse(
			text,
			{instant: anchor.toJSDate(), timezone: anchor.offset},
			{forwardDate: true},
		);
		const res = parsedResults[0];
		if (res == null) {
			return null;
		}
		const tags = res.tags();
		const relative =
			tags.has('result/relativeDate') || tags.has('result/relativeDateAndTime') || tags.has('casualReference/now');

		let dateTime: DateTime;
		if (relative || res.start.isCertain('timezoneOffset')) {
			dateTime = DateTime.fromJSDate(res.date(), {zone: timeZone});
		} else {
			const year = res.start.get('year') ?? anchor.year;
			const month = res.start.get('month') ?? anchor.month;
			const day = res.start.get('day') ?? anchor.day;
			const hour = res.start.get('hour') ?? 12;
			const minute = res.start.get('minute') ?? 0;
			const second = res.start.get('second') ?? 0;
			const millisecond = res.start.get('millisecond') ?? 0;
			dateTime = DateTime.fromObject({year, month, day, hour, minute, second, millisecond}, {zone: timeZone});
		}
		return dateTime.isValid ? {dateTime, relative, anchorMs} : null;
	} catch {
		// Text that is still being typed often says nothing yet.
		return null;
	}
}

/**
 * The whole second a time goes in as: rounded up, so a time ten minutes away is not already under
 * ten minutes, and shown as "in 9 minutes", when the composer first draws it (tyne-chat/tyne#389).
 */
export function insertedEpoch(dateTime: DateTime): number {
	return Math.ceil(dateTime.toMillis() / 1000);
}

/**
 * Upstream's relative wording (`formatRelativeTime` in `messaging/utils/markdown/DateFormatter.ts`)
 * for a gap measured from a moment of the caller's, where upstream measures from its own clock.
 * The dialog shows a time typed as "in 10 minutes" this way, from the moment it was worked out
 * against, so it reads as typed until Insert. Keep it in step with upstream's:
 * `TimestampModalPreview.test.ts` compares the two.
 */
export function formatRelativeGap(diffMs: number): string {
	const rtf = getRelativeTimeFormat(getCurrentLocale());
	const absMs = Math.abs(diffMs);
	const direction = diffMs >= 0 ? 1 : -1;
	const absDays = Math.floor(absMs / MS_PER_DAY);
	if (absDays >= 365) {
		return rtf.format(direction * Math.floor(absDays / 365), 'year');
	}
	if (absDays >= 30) {
		return rtf.format(direction * Math.floor(absDays / 30), 'month');
	}
	if (absDays >= 7) {
		return rtf.format(direction * Math.floor(absDays / 7), 'week');
	}
	if (absDays > 0) {
		return rtf.format(direction * absDays, 'day');
	}
	const absHours = Math.floor(absMs / MS_PER_HOUR);
	if (absHours > 0) {
		return rtf.format(direction * absHours, 'hour');
	}
	const absMinutes = Math.floor(absMs / MS_PER_MINUTE);
	if (absMinutes > 0) {
		return rtf.format(direction * absMinutes, 'minute');
	}
	return rtf.format(direction * Math.floor(absMs / MS_PER_SECOND), 'second');
}
