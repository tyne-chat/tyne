// SPDX-License-Identifier: AGPL-3.0-or-later

import {groupEditChanges, hasGroupEdits, shownGroupIds} from '@app/features/persona/utils/PersonaGroupEdits';
import {describe, expect, it} from 'vitest';

const group = (id: string, personaIds: Array<string> = []) => ({id, name: id, persona_ids: personaIds});

// The persona editor's Groups (tyne-chat/tyne#829): Save sends only what was ticked or unticked.
describe('persona group edits', () => {
	it('shows the groups as they are, with the ticks on top', () => {
		const groups = [group('core', ['10']), group('visitors'), group('littles', ['10'])];
		expect(shownGroupIds(groups, '10', {})).toEqual(['core', 'littles']);
		expect(shownGroupIds(groups, '10', {visitors: true, littles: false})).toEqual(['core', 'visitors']);
		expect(shownGroupIds(groups, undefined, {visitors: true})).toEqual(['visitors']);
	});

	it('changes nothing when nothing was ticked, whatever the groups are now', () => {
		// The groups loaded after the editor opened, or another device changed them meanwhile.
		const groups = [group('core', ['10']), group('visitors', ['10'])];
		expect(groupEditChanges(groups, '10', {})).toEqual([]);
		expect(hasGroupEdits(groups, '10', {})).toBe(false);
	});

	it('sends only the ticks that differ from the groups as they are now', () => {
		const groups = [group('core', ['10']), group('visitors'), group('littles', ['10'])];
		const edits = {core: true, visitors: true, littles: false, deleted: true};
		expect(groupEditChanges(groups, '10', edits)).toEqual([
			{groupId: 'visitors', add: ['10']},
			{groupId: 'littles', remove: ['10']},
		]);
		expect(hasGroupEdits(groups, '10', edits)).toBe(true);
	});

	it('forgets a tick in a group deleted meanwhile, and one another device already made', () => {
		expect(hasGroupEdits([group('core', ['10'])], '10', {core: true, gone: true})).toBe(false);
	});

	it('puts a new persona in the ticked groups once it has an id', () => {
		const groups = [group('core'), group('visitors')];
		expect(hasGroupEdits(groups, undefined, {visitors: true})).toBe(true);
		expect(groupEditChanges(groups, '99', {visitors: true})).toEqual([{groupId: 'visitors', add: ['99']}]);
	});
});
