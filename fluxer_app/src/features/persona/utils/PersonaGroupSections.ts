// SPDX-License-Identifier: AGPL-3.0-or-later

import {NOT_IN_A_GROUP_FOLD_ID} from '@app/features/persona/state/PersonaGroupFolds';
import type {PersonaGroupResponse} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';

export interface PersonaGroupSection {
	/** The group's id, or `NOT_IN_A_GROUP_FOLD_ID` for the personas in no group. */
	id: string;
	/** The group's name; null for the personas in no group. */
	name: string | null;
	/** The personas shown in it, in the list's order. */
	personaIds: Array<string>;
	folded: boolean;
}

/**
 * The persona settings list cut into sections (tyne-chat/tyne#829): one per group, in the groups'
 * order, then the personas in no group. `shownIds` are the live personas the chip lets through, in
 * the list's order; a persona in several groups is in each of their sections. A group with nothing
 * shown still has its section, so a new group shows at once, except while a chip filters the list;
 * the section for personas in no group shows only when it has some.
 *
 * Null when there are no sections to draw: the account has no groups, or a search is typed (search
 * shows every match once, folded or not).
 */
export function personaGroupSections(
	shownIds: ReadonlyArray<string>,
	groups: ReadonlyArray<PersonaGroupResponse>,
	isFolded: (sectionId: string) => boolean,
	options: {searching: boolean; filtering: boolean},
): Array<PersonaGroupSection> | null {
	if (groups.length === 0 || options.searching) return null;
	const sections: Array<PersonaGroupSection> = [];
	const grouped = new Set<string>();
	for (const group of groups) {
		const members = new Set(group.persona_ids);
		const personaIds = shownIds.filter((id) => members.has(id));
		for (const id of group.persona_ids) grouped.add(id);
		if (personaIds.length === 0 && options.filtering) continue;
		sections.push({id: group.id, name: group.name, personaIds, folded: isFolded(group.id)});
	}
	const loose = shownIds.filter((id) => !grouped.has(id));
	if (loose.length > 0) {
		sections.push({
			id: NOT_IN_A_GROUP_FOLD_ID,
			name: null,
			personaIds: loose,
			folded: isFolded(NOT_IN_A_GROUP_FOLD_ID),
		});
	}
	return sections;
}
