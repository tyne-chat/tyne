// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the personas an account has blocked (tyne-chat/tyne#921). One row per blocked persona, one
// partition per account: the whole list is one read, a block or an unblock is one write that cannot
// undo another made at the same moment, and deleting the account removes the list in one write.

import type {PersonaID, UserID} from '@app/api/BrandedTypes';
import {deleteOneOrMany, fetchMany, upsertOne} from '@app/api/database/CassandraQueryExecution';
import type {PersonaBlockRow} from '@app/api/database/types/PersonaTypes';
import {PersonaBlocks} from '@app/api/Tables';
import type {PersonaBlockResponse} from '@fluxer/schema/src/domains/persona/PersonaBlockSchemas';

const FETCH_BY_USER = PersonaBlocks.select({where: PersonaBlocks.where.eq('user_id')});

/** The account's blocked personas, the oldest block first. */
export async function loadPersonaBlocks(userId: UserID): Promise<Array<PersonaBlockRow>> {
	const rows = await fetchMany<PersonaBlockRow>(FETCH_BY_USER.bind({user_id: userId}));
	return rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}

export async function storePersonaBlock(row: PersonaBlockRow): Promise<void> {
	await upsertOne(PersonaBlocks.upsertAll(row));
}

export async function removePersonaBlock(
	userId: UserID,
	targetUserId: UserID,
	targetPersonaId: PersonaID,
): Promise<void> {
	await deleteOneOrMany(
		PersonaBlocks.deleteByPk({user_id: userId, target_user_id: targetUserId, target_persona_id: targetPersonaId}),
	);
}

export async function forgetPersonaBlocksOfUser(userId: UserID): Promise<void> {
	await deleteOneOrMany(PersonaBlocks.deletePartition({user_id: userId}));
}

export function toPersonaBlockResponse(row: PersonaBlockRow): PersonaBlockResponse {
	return {user_id: row.target_user_id.toString(), persona_id: row.target_persona_id.toString()};
}
