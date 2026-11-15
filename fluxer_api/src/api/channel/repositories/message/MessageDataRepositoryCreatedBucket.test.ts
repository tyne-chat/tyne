// SPDX-License-Identifier: AGPL-3.0-or-later

import {type ChannelID, createChannelID, createMessageID, createUserID, type MessageID} from '@app/api/BrandedTypes';
import {MessageDataRepository} from '@app/api/channel/repositories/message/MessageDataRepository';
import {fetchOne, setCassandraQueryExecutorForTesting, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {Db, type KvAdvance} from '@app/api/database/CassandraTypes';
import type {ChannelStateRow, MessageRow} from '@app/api/database/types/MessageTypes';
import {ChannelState} from '@app/api/Tables';
import {InMemoryCassandraQueryExecutor} from '@app/api/test/InMemoryCassandraQueryExecutor';
import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

// A channel's created_bucket, once lowered for history older than the channel, stays lowered when
// messages are written (tyne-chat/tyne#653).

const FETCH_CHANNEL_STATE = ChannelState.select({where: ChannelState.where.eq('channel_id'), limit: 1});
const CHANNEL_ID = createChannelID(1710000000000000000n);
const IMPORTED_BUCKET = 10;

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
		has_reaction: false,
		version: 1,
	};
}

async function channelState(): Promise<ChannelStateRow | null> {
	return fetchOne<ChannelStateRow>(FETCH_CHANNEL_STATE.bind({channel_id: CHANNEL_ID}));
}

// The Postgres executor applies an advance in one statement: `insert` for a new row, `always` (and
// `set` when the guard passes) merged into an existing one. This records what it would be given.
class RecordingAdvanceExecutor extends InMemoryCassandraQueryExecutor {
	readonly advances: Array<KvAdvance> = [];

	async advanceRows(writes: ReadonlyArray<KvAdvance>): Promise<Array<boolean>> {
		this.advances.push(...writes);
		return writes.map(() => true);
	}
}

describe('MessageDataRepository keeps a lowered created_bucket', () => {
	afterEach(() => {
		setCassandraQueryExecutorForTesting(new InMemoryCassandraQueryExecutor());
	});

	describe('without an advance executor', () => {
		beforeEach(() => {
			setCassandraQueryExecutorForTesting(new InMemoryCassandraQueryExecutor());
		});

		it("sets the channel's own bucket for a new channel", async () => {
			await new MessageDataRepository().upsertMessage(
				messageRow(CHANNEL_ID, createMessageID(1720000000000000000n)),
				null,
			);

			expect((await channelState())?.created_bucket).toBe(BucketUtils.makeBucket(CHANNEL_ID));
		});

		it('leaves a lowered bucket alone on later messages, newer and older', async () => {
			const repository = new MessageDataRepository();
			await repository.upsertMessage(messageRow(CHANNEL_ID, createMessageID(1720000000000000000n)), null);
			await upsertOne(ChannelState.patchByPk({channel_id: CHANNEL_ID}, {created_bucket: Db.set(IMPORTED_BUCKET)}));

			await repository.upsertMessage(messageRow(CHANNEL_ID, createMessageID(1730000000000000000n)), null);
			await repository.upsertMessage(messageRow(CHANNEL_ID, createMessageID(1715000000000000000n)), null);

			expect(await channelState()).toMatchObject({
				created_bucket: IMPORTED_BUCKET,
				last_message_id: createMessageID(1730000000000000000n),
				has_messages: true,
			});
		});
	});

	describe('with an advance executor', () => {
		let executor: RecordingAdvanceExecutor;
		beforeEach(() => {
			executor = new RecordingAdvanceExecutor();
			setCassandraQueryExecutorForTesting(executor);
		});

		it('writes created_bucket only for a new row', async () => {
			await new MessageDataRepository().upsertMessage(
				messageRow(CHANNEL_ID, createMessageID(1720000000000000000n)),
				null,
			);

			const advance = executor.advances.find((write) => write.table.name === ChannelState.name);
			expect(advance?.always).toBeDefined();
			expect(advance?.always).not.toHaveProperty('created_bucket');
			expect(advance?.always).toMatchObject({has_messages: true});
			expect(advance?.insert).toMatchObject({
				channel_id: CHANNEL_ID,
				created_bucket: BucketUtils.makeBucket(CHANNEL_ID),
			});
		});
	});
});
