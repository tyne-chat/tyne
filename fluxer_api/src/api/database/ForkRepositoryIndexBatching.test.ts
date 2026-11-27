// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: regression tests proving sequential base/index writes in MessageAuthorRepository,
// BillingDocumentRepository, and BillingSubscriptionRepository risk index desync on partial failure
// and pass once executed via atomic BatchBuilder batches (tyne-chat/tyne#948).

import {createChannelID, createMessageID, createUserID, type UserID} from '@app/api/BrandedTypes';
import {BillingSubscriptionRepository} from '@app/api/billing/repositories/BillingSubscriptionRepository';
import {BillingDocumentRepository} from '@app/api/billing_documents/BillingDocumentRepository';
import {BillingDocumentsByMonth, BillingDocumentsByUser} from '@app/api/billing_documents/BillingDocumentTables';
import {MessageAuthorRepository} from '@app/api/channel/repositories/message/MessageAuthorRepository';
import {
	type CassandraQueryExecutorForTesting,
	fetchMany,
	fetchOne,
	resetCassandraQueryExecutorForTesting,
	setCassandraQueryExecutorForTesting,
	upsertOne,
} from '@app/api/database/CassandraQueryExecution';
import type {KvQueryMeta, PreparedQuery} from '@app/api/database/CassandraTypes';
import type {BillingDocumentRow} from '@app/api/database/types/BillingDocumentTypes';
import {Messages, MessagesByAuthorV2} from '@app/api/Tables';
import {InMemoryCassandraQueryExecutor} from '@app/api/test/InMemoryCassandraQueryExecutor';
import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
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
				throw new Error(`simulated unbatched write failure #${this.failUnbatchedMutationOnCall}`);
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

describe('Upstream repository atomic index batching', () => {
	let spy: SpyCassandraExecutor;

	beforeEach(() => {
		spy = new SpyCassandraExecutor();
		setCassandraQueryExecutorForTesting(spy);
	});

	afterEach(() => {
		resetCassandraQueryExecutorForTesting();
	});

	it('MessageAuthorRepository.anonymizeMessage batches MessagesByAuthorV2 and Messages atomically', async () => {
		const channelId = createChannelID(10001n);
		const messageId = createMessageID(20001n);
		const oldAuthorId = createUserID(30001n);
		const newAuthorId = createUserID(30002n);
		const bucket = BucketUtils.makeBucket(messageId);

		await upsertOne(
			Messages.upsertAll({
				channel_id: channelId,
				bucket,
				message_id: messageId,
				author_id: oldAuthorId,
				type: 0,
				webhook_id: null,
				webhook_name: null,
				webhook_avatar_hash: null,
				content: 'hello',
				edited_timestamp: null,
				pinned_timestamp: null,
				flags: 0,
				mention_everyone: false,
				mention_users: null,
				mention_roles: null,
				mention_channels: null,
				attachments: null,
				embeds: null,
				sticker_items: null,
				message_reference: null,
				message_snapshots: null,
				call: null,
				has_reaction: null,
				version: 1,
			}),
		);
		await upsertOne(
			MessagesByAuthorV2.upsertAll({
				author_id: oldAuthorId,
				channel_id: channelId,
				message_id: messageId,
			}),
		);

		spy.unbatchedMutations.length = 0;
		spy.batches.length = 0;
		// Before the fix, anonymizeMessage ran 3 separate awaited writes so failure on #2 desynced index vs primary.
		spy.failUnbatchedMutationOnCall = 2;

		const repo = new MessageAuthorRepository({
			getMessage: async () =>
				({
					channelId,
					id: messageId,
					authorId: oldAuthorId,
					personaId: null,
				}) as never,
		} as never);

		await repo.anonymizeMessage(channelId, messageId, newAuthorId);

		expect(spy.unbatchedMutations).toEqual([]);
		expect(spy.batches).toHaveLength(1);
		expect(spy.batches[0]?.atomic).toBe(true);
		expect(spy.batches[0]?.queries).toHaveLength(3);

		const oldIndex = await repo.listMessagesByAuthor(oldAuthorId);
		const newIndex = await repo.listMessagesByAuthor(newAuthorId);
		const storedMessage = await fetchOne<{author_id: UserID | null}>(
			Messages.select({
				columns: ['author_id'],
				where: [Messages.where.eq('channel_id'), Messages.where.eq('bucket'), Messages.where.eq('message_id')],
			}).bind({
				channel_id: channelId,
				bucket,
				message_id: messageId,
			}),
		);
		expect(oldIndex).toEqual([]);
		expect(newIndex).toEqual([{channelId, messageId}]);
		expect(storedMessage?.author_id).toBe(newAuthorId);
	});

	it('BillingDocumentRepository.createDocument batches BillingDocumentsByUser and BillingDocumentsByMonth atomically', async () => {
		const userId = 70001n;
		const documentId = 80001n;
		const issuedAt = new Date('2026-11-27T10:00:00.000Z');
		const row: BillingDocumentRow = {
			document_id: documentId,
			series: 'INV',
			number: 1n,
			display_number: 'INV-1',
			kind: 'invoice',
			flow: 'subscription',
			layout: 'standard',
			issued_at: issuedAt,
			supply_date: '2026-11-27',
			period_start: null,
			period_end: null,
			currency: 'eur',
			total_minor: 500n,
			tax_minor: 0n,
			tax_lines: '[]',
			sek_tax_minor: null,
			fx_rate: null,
			fx_date: null,
			buyer: '{}',
			seller: '{}',
			language: 'en',
			original_document_id: null,
			original_number: null,
			reason: null,
			source_key: 'in_test_1',
			stripe_refs: '{}',
			user_id: userId,
			donor_email_hash: null,
			content: '{}',
			content_sha256: 'abc',
			pdf: Buffer.from('pdf'),
			pdf_sha256: 'def',
			render_version: '1',
			emailed_at: null,
			archived_at: null,
		};

		// Unbatched #1 is LWT insertIfNotExists(BillingDocuments). Before the fix, #2 and #3 wrote ByUser & ByMonth separately.
		spy.failUnbatchedMutationOnCall = 3;
		const repo = new BillingDocumentRepository();
		await repo.createDocument(row, {indexMonth: true});

		expect(spy.batches).toHaveLength(1);
		expect(spy.batches[0]?.atomic).toBe(true);
		expect(spy.batches[0]?.queries).toHaveLength(2);

		const byUser = await fetchMany<{document_id: bigint}>(
			BillingDocumentsByUser.select({where: BillingDocumentsByUser.where.eq('user_id')}).bind({user_id: userId}),
		);
		const byMonth = await fetchMany<{document_id: bigint}>(
			BillingDocumentsByMonth.select({where: BillingDocumentsByMonth.where.eq('month')}).bind({month: '2026-11'}),
		);
		expect(byUser.map((r) => r.document_id)).toEqual([documentId]);
		expect(byMonth.map((r) => r.document_id)).toEqual([documentId]);
	});

	it('BillingSubscriptionRepository.upsertFromStripe batches customer and user index writes atomically', async () => {
		const userId = 90001n;
		// Unbatched #1 is LWT primary BillingSubscriptions upsert. Before the fix, #2 and #3 wrote ByCustomer & ByUser separately.
		spy.failUnbatchedMutationOnCall = 3;
		const repo = new BillingSubscriptionRepository();

		const {row} = await repo.upsertFromStripe(
			{
				id: 'sub_atomic_1',
				customer: 'cus_atomic_1',
				status: 'active',
				items: {data: []},
				metadata: {user_id: userId.toString()},
			},
			{knownUserId: userId},
		);

		expect(row.provider_id).toBe('sub_atomic_1');
		expect(spy.batches).toHaveLength(1);
		expect(spy.batches[0]?.atomic).toBe(true);
		expect(spy.batches[0]?.queries).toHaveLength(2);

		const byCustomer = await repo.listByCustomer('cus_atomic_1');
		const byUser = await repo.listByUser(userId);
		expect(byCustomer.map((r) => r.provider_id)).toEqual(['sub_atomic_1']);
		expect(byUser.map((r) => r.provider_id)).toEqual(['sub_atomic_1']);
	});
});
