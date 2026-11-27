// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: regression guard ensuring ThreadOwnerPersonaStore mutates primary and index tables atomically
// via Cassandra batches so partial failures never leave dangling index rows (tyne-chat/tyne#947).

import {createChannelID, createPersonaID, createUserID} from '@app/api/BrandedTypes';
import {
	type CassandraQueryExecutorForTesting,
	fetchMany,
	resetCassandraQueryExecutorForTesting,
	setCassandraQueryExecutorForTesting,
} from '@app/api/database/CassandraQueryExecution';
import type {KvQueryMeta, PreparedQuery} from '@app/api/database/CassandraTypes';
import {
	forgetThreadOwnerPersona,
	forgetThreadOwnerPersonasOfUser,
	loadThreadOwnerPersonaId,
	storeThreadOwnerPersona,
} from '@app/api/persona/ThreadOwnerPersonaStore';
import {ThreadOwnerPersonasByUser} from '@app/api/Tables';
import {InMemoryCassandraQueryExecutor} from '@app/api/test/InMemoryCassandraQueryExecutor';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

class SpyCassandraExecutor implements CassandraQueryExecutorForTesting {
	readonly inner = new InMemoryCassandraQueryExecutor();
	readonly unbatchedMutations: Array<string> = [];
	readonly batches: Array<{queries: Array<{query: string; params: object; meta?: KvQueryMeta}>; atomic: boolean}> = [];
	failUnbatchedMutationOnCall: number | null = null;

	async executeQuery<T = Record<string, unknown>>(query: PreparedQuery): Promise<Array<T>> {
		const upper = query.cql.trimStart().toUpperCase();
		if (!upper.startsWith('SELECT')) {
			this.unbatchedMutations.push(query.cql);
			if (
				this.failUnbatchedMutationOnCall !== null &&
				this.unbatchedMutations.length === this.failUnbatchedMutationOnCall
			) {
				throw new Error('simulated second unbatched write failure');
			}
		}
		return this.inner.executeQuery<T>(query);
	}

	async executeBatch(
		queries: Array<{query: string; params: object; meta?: KvQueryMeta}>,
		atomic = true,
	): Promise<void> {
		this.batches.push({queries, atomic});
		return this.inner.executeBatch(queries, atomic);
	}
}

describe('ThreadOwnerPersonaStore atomic dual-table mutations', () => {
	let spy: SpyCassandraExecutor;

	beforeEach(() => {
		spy = new SpyCassandraExecutor();
		setCassandraQueryExecutorForTesting(spy);
	});

	afterEach(() => {
		resetCassandraQueryExecutorForTesting();
	});

	it('stores thread owner and by-user index rows in one atomic batch', async () => {
		const threadId = createChannelID(1001n);
		const userId = createUserID(2002n);
		const personaId = createPersonaID(3003n);

		await storeThreadOwnerPersona(threadId, userId, personaId);

		expect(spy.unbatchedMutations).toEqual([]);
		expect(spy.batches.length).toBe(1);
		expect(spy.batches[0]?.atomic).toBe(true);
		expect(spy.batches[0]?.queries).toHaveLength(2);
		expect(await loadThreadOwnerPersonaId(threadId)).toBe(personaId);
	});

	it('deletes primary and by-user index rows atomically without leaving orphan index rows on failure', async () => {
		const threadId = createChannelID(1002n);
		const userId = createUserID(2002n);
		const personaId = createPersonaID(3004n);

		await storeThreadOwnerPersona(threadId, userId, personaId);
		spy.unbatchedMutations.length = 0;
		spy.batches.length = 0;
		spy.failUnbatchedMutationOnCall = 2;

		await forgetThreadOwnerPersona(threadId);

		// Primary row and by-user index row must move together in a logged batch, never sequential deletes.
		expect(spy.unbatchedMutations).toEqual([]);
		expect(spy.batches.length).toBe(1);
		expect(spy.batches[0]?.atomic).toBe(true);
		expect(spy.batches[0]?.queries).toHaveLength(2);

		const remainingByUser = await fetchMany<{thread_id: unknown}>(
			ThreadOwnerPersonasByUser.select({where: ThreadOwnerPersonasByUser.where.eq('user_id')}).bind({user_id: userId}),
		);
		expect(remainingByUser).toEqual([]);
		expect(await loadThreadOwnerPersonaId(threadId)).toBeNull();
	});

	it('batches user-wide thread owner deletions instead of issuing unbatched per-row deletes', async () => {
		const userId = createUserID(2003n);
		const threadA = createChannelID(1010n);
		const threadB = createChannelID(1011n);
		const personaId = createPersonaID(3005n);

		await storeThreadOwnerPersona(threadA, userId, personaId);
		await storeThreadOwnerPersona(threadB, userId, personaId);
		spy.unbatchedMutations.length = 0;
		spy.batches.length = 0;

		await forgetThreadOwnerPersonasOfUser(userId);

		expect(spy.unbatchedMutations).toEqual([]);
		expect(spy.batches.length).toBeGreaterThanOrEqual(1);
		expect(await loadThreadOwnerPersonaId(threadA)).toBeNull();
		expect(await loadThreadOwnerPersonaId(threadB)).toBeNull();
	});
});
