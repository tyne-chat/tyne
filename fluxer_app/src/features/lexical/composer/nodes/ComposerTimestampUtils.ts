// SPDX-License-Identifier: AGPL-3.0-or-later

import {formatTimestamp} from '@app/features/messaging/utils/markdown/DateFormatter';
import {TimestampStyle} from '@app/features/messaging/utils/markdown/parser/Enums';
import type {I18n} from '@lingui/core';

export type ComposerTimestampFormat =
	| 'combo'
	| 'shortTime'
	| 'longTime'
	| 'shortDate'
	| 'longDate'
	| 'shortDateTime'
	| 'longDateTime'
	| 'relative';

const STYLE_TO_FORMAT: Record<string, ComposerTimestampFormat> = {
	t: 'shortTime',
	T: 'longTime',
	d: 'shortDate',
	D: 'longDate',
	f: 'shortDateTime',
	F: 'longDateTime',
	R: 'relative',
	combo: 'combo',
	default: 'shortDateTime',
	shortTime: 'shortTime',
	longTime: 'longTime',
	shortDate: 'shortDate',
	longDate: 'longDate',
	shortDateTime: 'shortDateTime',
	longDateTime: 'longDateTime',
	relative: 'relative',
};

const FORMAT_TO_STYLE: Record<ComposerTimestampFormat, TimestampStyle> = {
	combo: TimestampStyle.ShortDateTime,
	shortTime: TimestampStyle.ShortTime,
	longTime: TimestampStyle.LongTime,
	shortDate: TimestampStyle.ShortDate,
	longDate: TimestampStyle.LongDate,
	shortDateTime: TimestampStyle.ShortDateTime,
	longDateTime: TimestampStyle.LongDateTime,
	relative: TimestampStyle.RelativeTime,
};

export function normalizeTimestampFormat(formatOrStyle?: string | null): ComposerTimestampFormat {
	if (!formatOrStyle) {
		return 'shortDateTime';
	}
	return STYLE_TO_FORMAT[formatOrStyle] ?? 'shortDateTime';
}

export function getTimestampWire(epoch: number, format: ComposerTimestampFormat): string {
	switch (format) {
		case 'combo':
			return `<t:${epoch}:f> (<t:${epoch}:R>)`;
		case 'shortTime':
			return `<t:${epoch}:t>`;
		case 'longTime':
			return `<t:${epoch}:T>`;
		case 'shortDate':
			return `<t:${epoch}:d>`;
		case 'longDate':
			return `<t:${epoch}:D>`;
		case 'shortDateTime':
			return `<t:${epoch}:f>`;
		case 'longDateTime':
			return `<t:${epoch}:F>`;
		case 'relative':
			return `<t:${epoch}:R>`;
	}
}

export function getTimestampDisplay(epoch: number, format: ComposerTimestampFormat, i18n?: I18n): string {
	const dummyI18n = i18n ?? ({locale: 'en-US'} as I18n);
	if (format === 'combo') {
		const shortDateTime = formatTimestamp(epoch, TimestampStyle.ShortDateTime, dummyI18n);
		const relative = formatTimestamp(epoch, TimestampStyle.RelativeTime, dummyI18n);
		return `${shortDateTime} (${relative})`;
	}
	const style = FORMAT_TO_STYLE[format] ?? TimestampStyle.ShortDateTime;
	return formatTimestamp(epoch, style, dummyI18n);
}

export const TIMESTAMP_COMBO_REGEX = /^<t:(-?\d+):f>\s*\((<t:\1:R>)\)/;
export const TIMESTAMP_SINGLE_REGEX = /^<t:(-?\d+)(?::([tTdDfFsSR]))?>/;
export const GLOBAL_TIMESTAMP_COMBO_REGEX = /<t:(-?\d+):f>\s*\((<t:\1:R>)\)/g;
export const GLOBAL_TIMESTAMP_SINGLE_REGEX = /<t:(-?\d+)(?::([tTdDfFsSR]))?>/g;

export function parseTimestampWire(wire: string): {epoch: number; format: ComposerTimestampFormat} | null {
	const comboMatch = TIMESTAMP_COMBO_REGEX.exec(wire.trim());
	if (comboMatch != null && comboMatch[1] != null) {
		const epoch = Number.parseInt(comboMatch[1], 10);
		if (Number.isFinite(epoch)) {
			return {epoch, format: 'combo'};
		}
	}
	const singleMatch = TIMESTAMP_SINGLE_REGEX.exec(wire.trim());
	if (singleMatch != null && singleMatch[1] != null) {
		const epoch = Number.parseInt(singleMatch[1], 10);
		if (Number.isFinite(epoch)) {
			const format = normalizeTimestampFormat(singleMatch[2]);
			return {epoch, format};
		}
	}
	return null;
}
