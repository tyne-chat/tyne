// SPDX-License-Identifier: AGPL-3.0-or-later

import {fitFilename, MAX_FILENAME_BYTES} from '@app/api/discord_import/ImportFilenames';
import {describe, expect, it} from 'vitest';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('fitFilename', () => {
	it('leaves a name that fits as it is', () => {
		expect(fitFilename('todo_clips.csv')).toBe('todo_clips.csv');
		const exact = `${'a'.repeat(MAX_FILENAME_BYTES - 4)}.png`;
		expect(fitFilename(exact)).toBe(exact);
	});

	it('cuts a long name to 255 bytes, keeping its start and its extension', () => {
		// As in the export that stopped the scratch import (2026-11-28): a 360-byte name.
		const name = `AIJ2gl-E-${'x'.repeat(340)}As1024-rj.png`;
		const fitted = fitFilename(name);
		expect(bytes(fitted)).toBe(MAX_FILENAME_BYTES);
		expect(fitted.startsWith('AIJ2gl-E-xxx')).toBe(true);
		expect(fitted.endsWith('.png')).toBe(true);
	});

	it('counts bytes, not characters, and never cuts a character in half', () => {
		const fitted = fitFilename(`${'é'.repeat(200)}.jpg`);
		expect(bytes(fitted)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
		expect(fitted).toBe(`${'é'.repeat(125)}.jpg`);
		const emoji = fitFilename(`${'😀'.repeat(100)}.gif`);
		expect(emoji).toBe(`${'😀'.repeat(62)}.gif`);
	});

	it('treats a long tail after the last dot as part of the name', () => {
		const fitted = fitFilename(`report.${'y'.repeat(300)}`);
		expect(bytes(fitted)).toBe(MAX_FILENAME_BYTES);
		expect(fitted.startsWith('report.yyy')).toBe(true);
	});
});
