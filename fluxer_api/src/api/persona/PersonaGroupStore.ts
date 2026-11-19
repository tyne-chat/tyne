// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: groups of an account's personas (tyne-chat/tyne#829). One row per group, one partition per
// account, so the whole list is one read and deleting the account removes it in one write. The
// members live on the group's row: putting thirty personas in a group is one write, and editing a
// persona never touches its groups.
//
// A persona that is deleted stays in its groups, so that restoring it puts it back; the clients
// show only live personas.

import type {UserID} from '@app/api/BrandedTypes';
import {BatchBuilder, deleteOneOrMany, fetchMany, upsertOne} from '@app/api/database/CassandraQueryExecution';
import type {PersonaGroupRow} from '@app/api/database/types/PersonaTypes';
import {PersonaGroups} from '@app/api/Tables';
import type {PersonaGroupResponse} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';

const FETCH_BY_USER = PersonaGroups.select({where: PersonaGroups.where.eq('user_id')});

/** The account's groups, in the order they were made (their IDs grow with time). */
export async function loadPersonaGroups(userId: UserID): Promise<Array<PersonaGroupRow>> {
	const rows = await fetchMany<PersonaGroupRow>(FETCH_BY_USER.bind({user_id: userId}));
	return rows.sort((a, b) => {
		const left = BigInt(a.group_id);
		const right = BigInt(b.group_id);
		if (left === right) return 0;
		return left < right ? -1 : 1;
	});
}

/** Writes and deletes groups in one batch: all of them or none. */
export async function writePersonaGroups(
	userId: UserID,
	write: {upsert?: ReadonlyArray<PersonaGroupRow>; remove?: ReadonlyArray<bigint>},
): Promise<void> {
	const batch = new BatchBuilder();
	for (const row of write.upsert ?? []) batch.addPrepared(PersonaGroups.upsertAll(row));
	for (const groupId of write.remove ?? []) {
		batch.addPrepared(PersonaGroups.deleteByPk({user_id: userId, group_id: groupId}));
	}
	await batch.execute();
}

/**
 * Writes a group's name and nothing else: a row without its members is a partial update, so a
 * rename cannot undo a change to the members made at the same moment.
 */
export async function writePersonaGroupName(userId: UserID, groupId: bigint, name: string): Promise<void> {
	const row: Omit<PersonaGroupRow, 'persona_ids'> = {user_id: userId, group_id: groupId, name, updated_at: new Date()};
	await upsertOne(PersonaGroups.upsertAll(row as PersonaGroupRow));
}

export async function forgetPersonaGroupsOfUser(userId: UserID): Promise<void> {
	await deleteOneOrMany(PersonaGroups.deletePartition({user_id: userId}));
}

/** The members a row lists. A row that cannot be read lists none, rather than failing the account's list. */
export function personaGroupMemberIds(row: PersonaGroupRow): Array<string> {
	try {
		const parsed: unknown = JSON.parse(row.persona_ids);
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id)) : [];
	} catch {
		return [];
	}
}

export function toPersonaGroupResponse(row: PersonaGroupRow): PersonaGroupResponse {
	return {id: row.group_id.toString(), name: row.name, persona_ids: personaGroupMemberIds(row)};
}
