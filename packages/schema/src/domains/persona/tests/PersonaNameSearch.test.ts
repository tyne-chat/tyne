// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	normalizePersonaAliases,
	PERSONA_ALIASES_MAX,
	personaAliasesInclude,
	personaNameMatches,
	personaNameMatchScore,
	readPersonaAliases,
} from '../PersonaNameSearch';

describe('personaNameMatchScore (tyne-chat/tyne#707)', () => {
	it('finds a persona by any of its aliases when the name cannot be typed', () => {
		expect(personaNameMatches('SΛTVRN', ['Saturn'], 'sat')).toBe(true);
		expect(personaNameMatches('悪賢い', ['Sonic', 'Warui'], 'warui')).toBe(true);
		expect(personaNameMatches('神聖狐天使', ['Chelsea (Sol)'], 'sol')).toBe(true);
		expect(personaNameMatches('ΞΣNΛ', [], 'aelena')).toBe(false);
		expect(personaNameMatches('ΞΣNΛ', null, 'aelena')).toBe(false);
	});

	it('ranks a name match above the same match on an alias, and takes the best alias', () => {
		expect(personaNameMatchScore('Saturn', [], 'sat')).toBeGreaterThan(
			personaNameMatchScore('SΛTVRN', ['Saturn'], 'sat'),
		);
		expect(personaNameMatchScore('SΛTVRN', ['Saturn'], 'sat')).toBeGreaterThan(
			personaNameMatchScore('The Saturn', [], 'sat'),
		);
		expect(personaNameMatchScore('SΛTVRN', ['Big Saturn', 'Saturn'], 'sat')).toBe(
			personaNameMatchScore('SΛTVRN', ['Saturn'], 'sat'),
		);
	});

	it('lets a stronger match on an alias beat a weaker one on the name', () => {
		expect(personaNameMatchScore('SΛTVRN', ['Saturn'], 'saturn')).toBeGreaterThan(
			personaNameMatchScore('Lady Saturn', [], 'saturn'),
		);
		// "sol" is only inside the name, but starts the alias: the alias's match counts.
		expect(personaNameMatchScore('Marisol', ['Sol'], 'sol')).toBe(personaNameMatchScore('X', ['Sol'], 'sol'));
		expect(personaNameMatchScore('Saturn', ['Saturn'], 'saturn')).toBe(personaNameMatchScore('Saturn', [], 'saturn'));
	});

	it('takes an opening bracket as the start of a word', () => {
		expect(personaNameMatchScore('神聖狐天使', ['Chelsea (Sol)'], 'sol')).toBe(
			personaNameMatchScore('神聖狐天使', ['Chelsea Sol'], 'sol'),
		);
	});

	it('scores an empty query 0 and a miss -1', () => {
		expect(personaNameMatchScore('SΛTVRN', ['Saturn'], '  ')).toBe(0);
		expect(personaNameMatchScore('SΛTVRN', ['Saturn'], 'moon')).toBe(-1);
	});

	it('compares a whole alias without case or outer spaces', () => {
		expect(personaAliasesInclude([' Saturn '], 'saturn')).toBe(true);
		expect(personaAliasesInclude(['Saturn'], 'satur')).toBe(false);
		expect(personaAliasesInclude(['Saturn'], '')).toBe(false);
	});
});

describe('stored aliases', () => {
	it('are trimmed, without blanks or repeats, and capped', () => {
		expect(normalizePersonaAliases([' Saturn ', '', 'saturn', 'Sat'])).toEqual(['Saturn', 'Sat']);
		const many = Array.from({length: PERSONA_ALIASES_MAX + 3}, (_, i) => `a${i}`);
		expect(normalizePersonaAliases(many)).toHaveLength(PERSONA_ALIASES_MAX);
	});

	it('read from storage or a file accept only a list of strings', () => {
		expect(readPersonaAliases('["Saturn", 3, "Sat"]')).toEqual(['Saturn', 'Sat']);
		expect(readPersonaAliases(['Saturn'])).toEqual(['Saturn']);
		expect(readPersonaAliases('not json')).toEqual([]);
		expect(readPersonaAliases(null)).toEqual([]);
		// Cut at the limit without leaving half of a character.
		const long = `${'a'.repeat(99)}😀`;
		expect(readPersonaAliases([long])).toEqual(['a'.repeat(99)]);
	});
});
