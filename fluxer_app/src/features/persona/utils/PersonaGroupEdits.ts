// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaGroupMemberChange} from '@app/features/persona/commands/PersonaGroupCommands';
import type {PersonaGroupResponse} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';

/**
 * The persona editor's Groups (tyne-chat/tyne#829): only what the person ticked or unticked, by
 * group, never a copy of the persona's groups. The editor shows the groups as they are now with
 * these on top, and Save sends only the difference they make. So the groups loading after the
 * editor opened, or another device changing them meanwhile, never makes Save take the persona out
 * of a group nobody unticked here.
 */
export type PersonaGroupEdits = Readonly<Record<string, boolean>>;

/** Whether the editor shows the persona in the group. A persona not made yet is in none. */
function shownIn(group: PersonaGroupResponse, personaId: string | undefined, edits: PersonaGroupEdits): boolean {
	return edits[group.id] ?? (personaId !== undefined && group.persona_ids.includes(personaId));
}

export function shownGroupIds(
	groups: ReadonlyArray<PersonaGroupResponse>,
	personaId: string | undefined,
	edits: PersonaGroupEdits,
): Array<string> {
	return groups.filter((group) => shownIn(group, personaId, edits)).map((group) => group.id);
}

/** The requests' changes the edits make for this persona; edits of groups since deleted count for nothing. */
export function groupEditChanges(
	groups: ReadonlyArray<PersonaGroupResponse>,
	personaId: string,
	edits: PersonaGroupEdits,
): Array<PersonaGroupMemberChange> {
	const changes: Array<PersonaGroupMemberChange> = [];
	for (const group of groups) {
		const wanted = edits[group.id];
		if (wanted === undefined) continue;
		const isIn = group.persona_ids.includes(personaId);
		if (wanted && !isIn) changes.push({groupId: group.id, add: [personaId]});
		else if (!wanted && isIn) changes.push({groupId: group.id, remove: [personaId]});
	}
	return changes;
}

/** Whether the edits change anything for this persona, or for one not made yet (`undefined`). */
export function hasGroupEdits(
	groups: ReadonlyArray<PersonaGroupResponse>,
	personaId: string | undefined,
	edits: PersonaGroupEdits,
): boolean {
	return groups.some((group) => {
		const wanted = edits[group.id];
		return wanted !== undefined && wanted !== (personaId !== undefined && group.persona_ids.includes(personaId));
	});
}
