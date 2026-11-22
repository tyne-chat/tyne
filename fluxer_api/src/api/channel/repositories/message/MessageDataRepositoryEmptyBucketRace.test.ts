// SPDX-License-Identifier: AGPL-3.0-or-later

import {type ChannelID, createChannelID, createMessageID, createUserID, type MessageID} from '@app/api/BrandedTypes';
import {MessageDataRepository} from '@app/api/channel/repositories/message/MessageDataRepository';
import {getKvMeta} from '@app/api/database/CassandraMetaRegistry';
import {fetchMany, setCassandraQueryExecutorForTesting} from '@app/api/database/CassandraQueryExecution';
import type {PreparedQuery} from '@app/api/database/CassandraTypes';
import type {ChannelEmptyBucketRow, ChannelMessageBucketRow, MessageRow} from '@app/api/database/types/MessageTypes';
import {ChannelEmptyBuckets, ChannelMessageBuckets, Messages} from '@app/api/Tables';
import {InMemoryCassandraQueryExecutor} from '@app/api/test/InMemoryCassandraQueryExecutor';
import {generateSnowflake} from '@fluxer/snowflake/src/Snowflake';
import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

// A read that finds a bucket empty takes it out of the bucket index. When a message is sent into that
// bucket between the read and its removal, the index must still list the bucket: fluxer_messages lists
// a channel's messages from the buckets the index names and nothing else, so the message would be
// missing from every list until something put the bucket back (tyne-chat/tyne#881).

const FETCH_INDEXED_BUCKETS = ChannelMessageBuckets.select({
	columns: ['bucket'],
	where: ChannelMessageBuckets.where.eq('channel_id'),
});
const FETCH_EMPTY_BUCKETS = ChannelEmptyBuckets.select({
	columns: ['bucket'],
	where: ChannelEmptyBuckets.where.eq('channel_id'),
});

function messageRow(channelId: ChannelID, messageId: MessageID): MessageRow {
	return {
		channel_id: channelId,
		bucket: BucketUtils.makeBucket(messageId),
		message_id: messageId,
		author_id: createUserID(7n),
		type: 0,
		webhook_id: null,
		webhook_name: null,
		webhook_avatar_hash: null,
		content: 'first words in the thread',
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
		has_reaction: false,
		version: 1,
	};
}

// Runs a send right after the next read of a bucket that comes back empty, before the reader acts on
// what it found: the order the two requests ran in when the E2E test failed.
class SendAfterTheNextEmptyRead extends InMemoryCassandraQueryExecutor {
	private pendingSend: (() => Promise<void>) | null = null;

	sendAfterTheNextEmptyRead(send: () => Promise<void>): void {
		this.pendingSend = send;
	}

	override async executeQuery<T = Record<string, unknown>>(query: PreparedQuery): Promise<Array<T>> {
		const rows = await super.executeQuery<T>(query);
		const meta = query.kvMeta ?? getKvMeta(query.cql);
		if (this.pendingSend && rows.length === 0 && meta?.action === 'select' && meta.table.name === Messages.name) {
			const send = this.pendingSend;
			this.pendingSend = null;
			await send();
		}
		return rows;
	}
}

async function indexedBuckets(channelId: ChannelID): Promise<Array<number>> {
	const rows = await fetchMany<Pick<ChannelMessageBucketRow, 'bucket'>>(
		FETCH_INDEXED_BUCKETS.bind({channel_id: channelId}),
	);
	return rows.map((row) => row.bucket);
}

async function emptyBuckets(channelId: ChannelID): Promise<Array<number>> {
	const rows = await fetchMany<Pick<ChannelEmptyBucketRow, 'bucket'>>(
		FETCH_EMPTY_BUCKETS.bind({channel_id: channelId}),
	);
	return rows.map((row) => row.bucket);
}

describe('MessageDataRepository marking a bucket empty while a message is sent into it', () => {
	let executor: SendAfterTheNextEmptyRead;

	beforeEach(() => {
		executor = new SendAfterTheNextEmptyRead();
		setCassandraQueryExecutorForTesting(executor);
	});

	afterEach(() => {
		setCassandraQueryExecutorForTesting(new InMemoryCassandraQueryExecutor());
	});

	it('keeps the bucket in the index when the message lands between the empty read and the removal', async () => {
		const repository = new MessageDataRepository();
		const threadId = createChannelID(generateSnowflake());
		const messageId = createMessageID(generateSnowflake());
		const bucket = BucketUtils.makeBucket(messageId);
		executor.sendAfterTheNextEmptyRead(async () => {
			await repository.upsertMessage(messageRow(threadId, messageId));
		});

		// The read began before the send, so it rightly finds nothing.
		expect(await repository.listMessages(threadId, undefined, 1)).toEqual([]);

		expect(await indexedBuckets(threadId)).toContain(bucket);
		expect(await emptyBuckets(threadId)).not.toContain(bucket);
	});

	it('still takes a bucket that stays empty out of the index', async () => {
		const repository = new MessageDataRepository();
		const threadId = createChannelID(generateSnowflake());
		const bucket = BucketUtils.makeBucket(generateSnowflake());

		expect(await repository.listMessages(threadId, undefined, 1)).toEqual([]);

		expect(await indexedBuckets(threadId)).not.toContain(bucket);
		expect(await emptyBuckets(threadId)).toContain(bucket);
	});
});
