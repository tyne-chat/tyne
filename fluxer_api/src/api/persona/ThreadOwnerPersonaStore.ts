// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a member can start a thread as one of their personas. The thread's owner is still the
// account, which is what permissions, slowmode and the audit log go by. The persona is kept beside
// it as an ID only, so a renamed persona shows under its new name wherever the thread is listed.
//
// It lives in the fork's own tables, not in a column of upstream's thread_state: upstream pins that
// table's columns against its Cassandra schema and writes whole rows in its tests. The second table
// is the same rows by user, so that deleting an account can find and remove them.

import type {ChannelID, PersonaID, UserID} from '@app/api/BrandedTypes';
import {
	deleteOneOrMany,
	fetchMany,
	fetchManyInChunks,
	fetchOne,
	upsertOne,
} from '@app/api/database/CassandraQueryExecution';
import type {ThreadOwnerPersonaRow} from '@app/api/database/types/PersonaTypes';
import {Logger} from '@app/api/Logger';
import {ThreadOwnerPersonas, ThreadOwnerPersonasByUser} from '@app/api/Tables';

const FETCH_ONE = ThreadOwnerPersonas.select({where: ThreadOwnerPersonas.where.eq('thread_id'), limit: 1});
const FETCH_MANY = ThreadOwnerPersonas.select({where: ThreadOwnerPersonas.where.in('thread_id', 'thread_ids')});
const FETCH_BY_USER = ThreadOwnerPersonasByUser.select({where: ThreadOwnerPersonasByUser.where.eq('user_id')});

/**
 * Never fails the caller. The thread already exists when this runs, and a thread that could not
 * record its persona is still a thread: it reads as started by the account.
 */
export async function storeThreadOwnerPersona(
	threadId: ChannelID,
	userId: UserID,
	personaId: PersonaID,
): Promise<void> {
	const row: ThreadOwnerPersonaRow = {thread_id: threadId, user_id: userId, persona_id: personaId};
	try {
		// The by-user row goes first: a crash in between leaves a row that account deletion still finds.
		await upsertOne(ThreadOwnerPersonasByUser.upsertAll(row));
		await upsertOne(ThreadOwnerPersonas.upsertAll(row));
	} catch (error) {
		Logger.warn({error, threadId: threadId.toString()}, 'Failed to record the persona a thread was started as');
	}
}

export async function loadThreadOwnerPersonaId(threadId: ChannelID): Promise<PersonaID | null> {
	try {
		const row = await fetchOne<ThreadOwnerPersonaRow>(FETCH_ONE.bind({thread_id: threadId}));
		return row?.persona_id ?? null;
	} catch (error) {
		Logger.warn({error, threadId: threadId.toString()}, 'Failed to load the persona a thread was started as');
		return null;
	}
}

export async function loadThreadOwnerPersonaIds(threadIds: Array<ChannelID>): Promise<Map<ChannelID, PersonaID>> {
	try {
		const rows = await fetchManyInChunks<ThreadOwnerPersonaRow>(FETCH_MANY, threadIds, (chunk) => ({
			thread_ids: chunk,
		}));
		return new Map(rows.map((row) => [row.thread_id, row.persona_id]));
	} catch (error) {
		Logger.warn({error}, 'Failed to load the personas threads were started as');
		return new Map();
	}
}

export async function forgetThreadOwnerPersona(threadId: ChannelID): Promise<void> {
	const row = await fetchOne<ThreadOwnerPersonaRow>(FETCH_ONE.bind({thread_id: threadId}));
	if (!row) return;
	await deleteOneOrMany(ThreadOwnerPersonas.deleteByPk({thread_id: threadId}));
	await deleteOneOrMany(ThreadOwnerPersonasByUser.deleteByPk({user_id: row.user_id, thread_id: threadId}));
}

export async function forgetThreadOwnerPersonasOfUser(userId: UserID): Promise<void> {
	const rows = await fetchMany<ThreadOwnerPersonaRow>(FETCH_BY_USER.bind({user_id: userId}));
	for (const row of rows) {
		await deleteOneOrMany(ThreadOwnerPersonas.deleteByPk({thread_id: row.thread_id}));
	}
	await deleteOneOrMany(ThreadOwnerPersonasByUser.deletePartition({user_id: userId}));
}
