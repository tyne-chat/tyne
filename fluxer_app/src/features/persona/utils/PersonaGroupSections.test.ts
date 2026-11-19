// SPDX-License-Identifier: AGPL-3.0-or-later

import {NOT_IN_A_GROUP_FOLD_ID} from '@app/features/persona/state/PersonaGroupFolds';
import {personaGroupSections} from '@app/features/persona/utils/PersonaGroupSections';
import {describe, expect, it} from 'vitest';

const groups = [
	{id: 'core', name: 'Core', persona_ids: ['wren', 'marlowe']},
	{id: 'writers', name: "Writers' room", persona_ids: ['marlowe', 'isolde', 'gone']},
	{id: 'empty', name: 'Empty', persona_ids: []},
];
const unfolded = () => false;

describe('personaGroupSections (tyne-chat/tyne#829)', () => {
	it('is null without groups, and while searching, so the list is drawn flat as before', () => {
		expect(personaGroupSections(['wren'], [], unfolded, {searching: false, filtering: false})).toBeNull();
		expect(personaGroupSections(['wren'], groups, unfolded, {searching: true, filtering: false})).toBeNull();
	});

	it('gives one section per group in order, a persona under each of its groups, then the rest', () => {
		const sections = personaGroupSections(['isolde', 'marlowe', 'sable', 'wren'], groups, unfolded, {
			searching: false,
			filtering: false,
		});
		expect(sections?.map((s) => [s.id, s.name, s.personaIds])).toEqual([
			['core', 'Core', ['marlowe', 'wren']],
			['writers', "Writers' room", ['isolde', 'marlowe']],
			['empty', 'Empty', []],
			[NOT_IN_A_GROUP_FOLD_ID, null, ['sable']],
		]);
	});

	it('shows only live personas, and leaves out the rest section when every persona is in a group', () => {
		const sections = personaGroupSections(['marlowe', 'wren'], groups, unfolded, {searching: false, filtering: false});
		expect(sections?.map((s) => s.id)).toEqual(['core', 'writers', 'empty']);
		expect(sections?.[1].personaIds).toEqual(['marlowe']);
	});

	it('hides sections a chip leaves empty', () => {
		const sections = personaGroupSections(['isolde'], groups, unfolded, {searching: false, filtering: true});
		expect(sections?.map((s) => s.id)).toEqual(['writers']);
	});

	it('marks the folded sections, the rest section included', () => {
		const folded = new Set(['writers', NOT_IN_A_GROUP_FOLD_ID]);
		const sections = personaGroupSections(['isolde', 'sable', 'wren'], groups, (id) => folded.has(id), {
			searching: false,
			filtering: false,
		});
		expect(sections?.map((s) => [s.id, s.folded])).toEqual([
			['core', false],
			['writers', true],
			['empty', false],
			[NOT_IN_A_GROUP_FOLD_ID, true],
		]);
	});
});
