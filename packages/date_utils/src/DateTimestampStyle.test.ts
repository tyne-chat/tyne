import {describe, expect, it} from 'vitest';
import {formatTimestampWithStyle} from './DateTimestampStyle';
import {getCurrentTimeZoneOffsetMinutes, getTimeZoneDisplayOptions, isSupportedTimeZoneId} from './TimeZoneUtils';

describe('DateTimestampStyle - formatTimestampWithStyle', () => {
	// 2023-11-14T22:13:20Z = 1700000000
	const timestamp = 1700000000;

	it('formats with short time and default locale', () => {
		const result = formatTimestampWithStyle(timestamp, 'ShortTime', 'en-US', false, 'UTC');
		expect(result).toBe('22:13');
	});

	it('formats with 12-hour short time in UTC', () => {
		const result = formatTimestampWithStyle(timestamp, 'ShortTime', 'en-US', true, 'UTC');
		expect(result).toMatch(/10:13\s*(PM|pm)/i);
	});

	it('formats with long time including seconds', () => {
		const result = formatTimestampWithStyle(timestamp, 'LongTime', 'en-US', false, 'UTC');
		expect(result).toBe('22:13:20');
	});

	it('formats with short date', () => {
		const result = formatTimestampWithStyle(timestamp, 'ShortDate', 'en-US', false, 'UTC');
		expect(result).toMatch(/11\/14\/2023/);
	});

	it('formats with long date', () => {
		const result = formatTimestampWithStyle(timestamp, 'LongDate', 'en-US', false, 'UTC');
		expect(result).toContain('November 14, 2023');
	});

	it('adjusts formatted time across different timezones', () => {
		// In UTC: 22:13
		const utcResult = formatTimestampWithStyle(timestamp, 'ShortTime', 'en-US', false, 'UTC');
		// In Tokyo (UTC+9): next day 07:13
		const tokyoResult = formatTimestampWithStyle(timestamp, 'ShortTime', 'en-US', false, 'Asia/Tokyo');
		// In New York (UTC-5): 17:13
		const nyResult = formatTimestampWithStyle(timestamp, 'ShortTime', 'en-US', false, 'America/New_York');

		expect(utcResult).toBe('22:13');
		expect(tokyoResult).toBe('07:13');
		expect(nyResult).toBe('17:13');
	});

	it('handles date change across timezones for LongDateTime', () => {
		const tokyoResult = formatTimestampWithStyle(timestamp, 'LongDateTime', 'en-US', false, 'Asia/Tokyo');
		const nyResult = formatTimestampWithStyle(timestamp, 'LongDateTime', 'en-US', false, 'America/New_York');

		expect(tokyoResult).toContain('Wednesday, November 15, 2023');
		expect(nyResult).toContain('Tuesday, November 14, 2023');
	});

	it('gracefully falls back to runtime default if invalid timeZone is provided', () => {
		expect(() => {
			const result = formatTimestampWithStyle(timestamp, 'ShortTime', 'en-US', false, 'Invalid/TimeZone_DoesNotExist');
			expect(typeof result).toBe('string');
			expect(result.length).toBeGreaterThan(0);
		}).not.toThrow();
	});
});

describe('TimeZoneUtils', () => {
	it('validates supported time zones correctly', () => {
		expect(isSupportedTimeZoneId('UTC')).toBe(true);
		expect(isSupportedTimeZoneId('America/New_York')).toBe(true);
		expect(isSupportedTimeZoneId('Asia/Tokyo')).toBe(true);
		expect(isSupportedTimeZoneId('Europe/London')).toBe(true);
		expect(isSupportedTimeZoneId('Invalid/Unknown_Zone')).toBe(false);
		expect(isSupportedTimeZoneId(null)).toBe(false);
		expect(isSupportedTimeZoneId(undefined)).toBe(false);
	});

	it('retrieves current offset minutes for supported time zones', () => {
		expect(Math.abs(getCurrentTimeZoneOffsetMinutes('UTC') ?? 1)).toBe(0);
		expect(typeof getCurrentTimeZoneOffsetMinutes('Asia/Tokyo')).toBe('number');
		expect(typeof getCurrentTimeZoneOffsetMinutes('America/New_York')).toBe('number');
		expect(getCurrentTimeZoneOffsetMinutes('Fake/Zone')).toBe(null);
		expect(getCurrentTimeZoneOffsetMinutes('')).toBe(null);
	});

	it('returns rich display options including UTC and major cities', () => {
		const options = getTimeZoneDisplayOptions();
		expect(options.length).toBeGreaterThan(50);

		const utc = options.find((opt) => opt.value === 'UTC');
		expect(utc).toBeDefined();
		expect(utc?.label).toContain('UTC');

		const tokyo = options.find((opt) => opt.value === 'Asia/Tokyo');
		expect(tokyo).toBeDefined();
		expect(tokyo?.label).toContain('Tokyo');
		expect(tokyo?.searchText.toLowerCase()).toContain('japan');
	});
});
