// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {duplicatePersonaName} from './PersonaDuplicate';

describe('duplicatePersonaName', () => {
	it('numbers the first copy 2', () => {
		expect(duplicatePersonaName('Lyra', ['Lyra', 'Wren'])).toBe('Lyra (2)');
	});

	it('takes the first free number', () => {
		expect(duplicatePersonaName('Lyra', ['Lyra', 'Lyra (2)', 'Lyra (4)'])).toBe('Lyra (3)');
	});

	it('counts a copy of a copy on from the persona it copied', () => {
		expect(duplicatePersonaName('Lyra (2)', ['Lyra', 'Lyra (2)'])).toBe('Lyra (3)');
	});

	it('keeps a number in brackets that is part of the name', () => {
		expect(duplicatePersonaName('Lyra (2026)', ['Lyra (2026)'])).toBe('Lyra (2026) (2)');
		expect(duplicatePersonaName('Agent(7)', ['Agent(7)'])).toBe('Agent(7) (2)');
	});

	it('never gives the name itself, even when the list leaves it out', () => {
		expect(duplicatePersonaName('Lyra', [])).toBe('Lyra (2)');
		expect(duplicatePersonaName('Lyra (2)', ['Lyra'])).toBe('Lyra (3)');
	});

	it('compares names trimmed and ignoring case', () => {
		expect(duplicatePersonaName(' Lyra ', ['lyra', 'LYRA (2) '])).toBe('Lyra (3)');
	});

	it('shortens a long name so the number fits the 100-character limit', () => {
		const long = 'x'.repeat(100);
		const copy = duplicatePersonaName(long, [long]);
		expect(copy).toBe(`${'x'.repeat(96)} (2)`);
		expect(copy.length).toBe(100);
	});

	// The API and the name field count UTF-16 code units, where 🌙 is two.
	it('counts the limit as the API does, in UTF-16 code units', () => {
		const moons = '🌙'.repeat(50);
		const copy = duplicatePersonaName(moons, [moons]);
		expect(copy).toBe(`${'🌙'.repeat(48)} (2)`);
		expect(copy.length).toBe(100);
	});

	it('never cuts a character made of several code points', () => {
		const flag = '🏳️‍🌈';
		const copy = duplicatePersonaName(`${'x'.repeat(92)}${flag}`, []);
		expect(copy).toBe(`${'x'.repeat(92)} (2)`);
		const skin = '👍🏽';
		expect(duplicatePersonaName(`${'x'.repeat(94)}${skin}`, [])).toBe(`${'x'.repeat(94)} (2)`);
		expect(duplicatePersonaName(`${'x'.repeat(90)}${skin}`, [])).toBe(`${'x'.repeat(90)}${skin} (2)`);
	});
});
