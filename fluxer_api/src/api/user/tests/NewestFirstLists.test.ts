// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	createAttachmentID,
	createChannelID,
	createGuildID,
	createMemeID,
	createMessageID,
	createUserID,
} from '@app/api/BrandedTypes';
import {ChannelDataRepository} from '@app/api/channel/repositories/ChannelDataRepository';
import {MessageInteractionRepository} from '@app/api/channel/repositories/MessageInteractionRepository';
import {MessageRepository} from '@app/api/channel/repositories/MessageRepository';
import {FavoriteMemeRepository} from '@app/api/favorite_meme/FavoriteMemeRepository';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {UserRepository} from '@app/api/user/repositories/UserRepository';
import {UserHarvest} from '@app/api/user/UserHarvestModel';
import {UserHarvestRepository} from '@app/api/user/UserHarvestRepository';
import {MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

// Fork: lists that show the newest first. Their tables were declared newest first in Cassandra,
// so their queries asked for rows before an ID with a limit and no order. The Postgres store
// answers such a query oldest first, so once a list was longer than the limit it showed the
// oldest items and stopped changing (the mentions inbox froze on 2026-10-15). Each query now
// asks for the newest first.

const USER = createUserID(1_000_000_000_000_000_001n);
const CHANNEL = createChannelID(1_000_000_000_000_000_002n);
const FIRST_ID = 1_500_000_000_000_000_000n;

const offsets = (ids: Array<bigint>) => ids.map((id) => Number(id - FIRST_ID));
const newestFirst = (count: number, newest: number) => Array.from({length: count}, (_, i) => newest - i);

describe('lists shown newest first', () => {
	let harness: ApiTestHarness;
	beforeEach(async () => {
		harness = await createApiTestHarness();
	});
	afterEach(async () => {
		await harness?.shutdown();
	});

	test('recent mentions, past the size of one fetch, and the page before', async () => {
		const repository = new UserRepository();
		await repository.createRecentMentions(
			Array.from({length: 120}, (_, i) => ({
				user_id: USER,
				channel_id: CHANNEL,
				message_id: createMessageID(FIRST_ID + BigInt(i)),
				guild_id: createGuildID(1_000_000_000_000_000_003n),
				is_everyone: false,
				is_role: false,
			})),
		);

		const newest = await repository.listRecentMentions(USER, true, true, true, 50);
		const older = await repository.listRecentMentions(USER, true, true, true, 50, newest.at(-1)!.messageId);

		expect(offsets(newest.map((m) => m.messageId))).toEqual(newestFirst(50, 119));
		expect(offsets(older.map((m) => m.messageId))).toEqual(newestFirst(50, 69));
	});

	test('saved messages', async () => {
		const repository = new UserRepository();
		for (let i = 0; i < 60; i++) {
			await repository.createSavedMessage(USER, CHANNEL, createMessageID(FIRST_ID + BigInt(i)));
		}

		const newest = await repository.listSavedMessages(USER, 25);

		expect(offsets(newest.map((m) => m.messageId))).toEqual(newestFirst(25, 59));
	});

	test('channel pins, most recently pinned first', async () => {
		const messages = new MessageRepository(new ChannelDataRepository());
		const pins = new MessageInteractionRepository(messages);
		for (let i = 0; i < 5; i++) {
			const messageId = createMessageID(FIRST_ID + BigInt(i));
			const pinnedAt = new Date(Date.UTC(2026, 9, 1, 0, i));
			await messages.upsertMessage(
				{
					channel_id: CHANNEL,
					bucket: BucketUtils.makeBucket(messageId),
					message_id: messageId,
					author_id: USER,
					type: MessageTypes.DEFAULT,
					webhook_id: null,
					webhook_name: null,
					webhook_avatar_hash: null,
					content: `pin ${i}`,
					edited_timestamp: null,
					pinned_timestamp: pinnedAt,
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
				},
				null,
				{skipParentLastMessageId: true},
			);
			await pins.addChannelPin(CHANNEL, messageId, pinnedAt);
		}

		const newest = await pins.listChannelPins(CHANNEL, new Date(Date.UTC(2026, 9, 2)), 3);

		expect(offsets(newest.map((m) => m.id))).toEqual([4, 3, 2]);
	});

	test('the latest data export', async () => {
		const repository = new UserHarvestRepository();
		for (let i = 0; i < 3; i++) {
			await repository.create(
				new UserHarvest({
					user_id: USER,
					harvest_id: FIRST_ID + BigInt(i),
					requested_at: new Date(Date.UTC(2026, 9, 1 + i)),
					started_at: null,
					completed_at: null,
					failed_at: null,
					storage_key: null,
					file_size: null,
					progress_percent: 0,
					progress_step: null,
					error_message: null,
					download_url_expires_at: null,
				}),
			);
		}

		const latest = await repository.findLatestByUserId(USER);

		expect(offsets([latest!.harvestId])).toEqual([2]);
	});

	test('favorite memes', async () => {
		const repository = new FavoriteMemeRepository();
		for (let i = 0; i < 3; i++) {
			await repository.create({
				user_id: USER,
				meme_id: createMemeID(FIRST_ID + BigInt(i)),
				name: `meme ${i}`,
				attachment_id: createAttachmentID(FIRST_ID + BigInt(i)),
				filename: `meme-${i}.png`,
				content_type: 'image/png',
				size: 1n,
			});
		}

		const memes = await repository.findByUserId(USER);

		expect(offsets(memes.map((m) => m.id))).toEqual([2, 1, 0]);
	});
});
