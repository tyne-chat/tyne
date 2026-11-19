// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: renaming, moving or archiving an existing Tyne emoji during a Discord import (tyne-chat/tyne#608).
import type {EmojiID, GuildID, UserID} from '@app/api/BrandedTypes';
import {setCassandraQueryExecutorForTesting} from '@app/api/database/CassandraQueryExecution';
import type {GuildEmojiRow} from '@app/api/database/types/GuildTypes';
import {applyEmojiFates, type EmojiFatesDeps, type PlanEmojiFate} from '@app/api/discord_import/ImportEmojiFates';
import {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import {GuildEmoji} from '@app/api/models/GuildEmoji';
import {InMemoryCassandraQueryExecutor} from '@app/api/test/InMemoryCassandraQueryExecutor';
import {afterEach, describe, expect, it} from 'vitest';

const row = (guild: bigint, id: bigint, name: string): GuildEmojiRow => ({
	guild_id: guild as GuildID,
	emoji_id: id as EmojiID,
	name,
	creator_id: 1n as UserID,
	animated: false,
	version: 1,
});

const fate = (f: Partial<PlanEmojiFate>): PlanEmojiFate =>
	({
		emoji_id: '501',
		action: 'move',
		guild_id: '20',
		name: 'SeraphNod',
		from_guild_id: '10',
		old_name: 'NodNod',
		...f,
	}) as PlanEmojiFate;
const archive = (emojiId = '501'): PlanEmojiFate =>
	fate({emoji_id: emojiId, action: 'archive', guild_id: null, name: null});

function fakes(rows: Array<GuildEmojiRow>, guildsGone: Array<bigint> = []) {
	const byId = new Map(rows.map((r) => [r.emoji_id, r]));
	const calls: Array<string> = [];
	const deps: EmojiFatesDeps = {
		avatarService: {
			cloneEmojiImage: async ({sourceEmojiId, emojiId}) => {
				calls.push(`clone ${sourceEmojiId} ${emojiId}`);
			},
		},
		guildRepository: {
			getEmojiById: async (id) => {
				const r = byId.get(id);
				return r ? new GuildEmoji(r) : null;
			},
			deleteEmoji: async (guild, id) => {
				calls.push(`delete ${guild} ${id}`);
				byId.delete(id);
			},
			upsertEmoji: async (r) => {
				calls.push(`upsert ${r.guild_id} ${r.emoji_id} ${r.name}`);
				byId.set(r.emoji_id, r);
				return new GuildEmoji(r);
			},
			findUnique: (async (guildId: GuildID) => (guildsGone.includes(guildId) ? null : {id: guildId})) as never,
		},
		moveEmoji: async (from, r) => {
			calls.push(`move ${from} ${r.guild_id} ${r.emoji_id} ${r.name}`);
			byId.set(r.emoji_id, r);
		},
	};
	return {deps, calls, byId};
}

describe('applyEmojiFates', () => {
	it('moves an emoji to another community under its new name, keeping its id and creator', async () => {
		const {deps, calls, byId} = fakes([row(10n, 501n, 'NodNod')]);
		const result = await applyEmojiFates([fate({})], deps, false, '1');
		expect(calls).toEqual(['move 10 20 501 SeraphNod']);
		expect(byId.get(501n as EmojiID)?.creator_id).toBe(1n);
		expect(result).toEqual({
			guilds: ['10', '20'],
			done: ['501'],
			changed: [],
			missing: [],
			noCommunity: [],
			copied: [],
		});
	});

	it('renames one in its own community without taking it off the list', async () => {
		const {deps, calls} = fakes([row(10n, 501n, 'NodNod')]);
		const result = await applyEmojiFates([fate({guild_id: '10'})], deps, false, '1');
		expect(calls).toEqual(['upsert 10 501 SeraphNod']);
		expect(result.guilds).toEqual(['10']);
	});

	it('takes one off its community list for archive-only, and counts one gone already as done', async () => {
		const {deps, calls} = fakes([row(10n, 501n, 'NodNod')]);
		const result = await applyEmojiFates([archive(), archive('502')], deps, false, '1');
		expect(calls).toEqual(['delete 10 501']);
		expect(result).toEqual({
			guilds: ['10'],
			done: ['501', '502'],
			changed: [],
			missing: [],
			noCommunity: [],
			copied: [],
		});
	});

	it('leaves one changed on Tyne since the review as it is', async () => {
		const {deps, calls} = fakes([row(10n, 501n, 'RenamedOnTyne'), row(30n, 503n, 'NodNod')]);
		const result = await applyEmojiFates([fate({}), fate({emoji_id: '503'})], deps, false, '1');
		expect(calls).toEqual([]);
		expect(result.changed).toEqual(['501', '503']);
	});

	it('copies it to more communities as emoji of their own, once', async () => {
		const {deps, calls, byId} = fakes([row(10n, 501n, 'NodNod'), row(40n, 602n, 'NodNod')]);
		const copies = [
			{emoji_id: '601', guild_id: '30', name: 'NodNod'},
			{emoji_id: '602', guild_id: '40', name: 'NodNod'},
		];
		const result = await applyEmojiFates([fate({guild_id: '10', name: 'NodNod', copies})], deps, false, '7');
		expect(calls).toEqual(['clone 501 601', 'upsert 30 601 NodNod']);
		expect(byId.get(601n as EmojiID)?.creator_id).toBe(7n);
		// The lists of every community involved, those already done included.
		expect(result).toEqual({
			guilds: ['10', '30', '40'],
			done: ['501'],
			changed: [],
			missing: [],
			noCommunity: [],
			copied: ['601'],
		});
	});

	it('counts one already where it should be as done, and writes nothing in a dry run', async () => {
		const {deps, calls} = fakes([row(20n, 501n, 'SeraphNod'), row(10n, 502n, 'NodNod')]);
		const result = await applyEmojiFates([fate({}), fate({emoji_id: '502'}), fate({emoji_id: '999'})], deps, true, '1');
		expect(calls).toEqual([]);
		expect(result).toEqual({
			guilds: ['10', '20'],
			done: ['501', '502'],
			changed: [],
			missing: ['999'],
			noCommunity: [],
			copied: [],
		});
	});

	// Gemini Carbon's review of tyne-chat/tyne#608.
	it('sends the lists again for fates an earlier run applied before it stopped', async () => {
		const {deps, calls} = fakes([row(20n, 501n, 'SeraphNod')]);
		const result = await applyEmojiFates([fate({}), archive('502')], deps, false, '1');
		expect(calls).toEqual([]);
		expect(result.guilds).toEqual(['10', '20']);
		expect(result.done).toEqual(['501', '502']);
	});

	it('leaves an emoji where it is when the community it was to go to is gone, and makes no copy there', async () => {
		const {deps, calls} = fakes([row(10n, 501n, 'NodNod'), row(10n, 502n, 'Wave')], [20n, 30n]);
		const copies = [{emoji_id: '601', guild_id: '30', name: 'Wave'}];
		const result = await applyEmojiFates(
			[fate({}), fate({emoji_id: '502', guild_id: '10', name: 'Wave', old_name: 'Wave', copies})],
			deps,
			false,
			'1',
		);
		expect(calls).toEqual([]);
		expect(result.noCommunity).toEqual(['501', '601']);
	});

	it('renames a copy an earlier run made, unless it was renamed on Tyne since', async () => {
		const {deps, calls} = fakes([row(10n, 501n, 'NodNod'), row(30n, 601n, 'NodNod'), row(40n, 602n, 'OnTyne')]);
		const copies = [
			{emoji_id: '601', guild_id: '30', name: 'Nodding', old_name: 'NodNod'},
			{emoji_id: '602', guild_id: '40', name: 'Nodding', old_name: 'NodNod'},
		];
		const result = await applyEmojiFates([fate({guild_id: '10', name: 'NodNod', copies})], deps, false, '1');
		expect(calls).toEqual(['upsert 30 601 Nodding']);
		expect(result.changed).toEqual(['602']);
	});
});

describe('applyEmojiFates on the database', () => {
	afterEach(() => setCassandraQueryExecutorForTesting(null));

	it('moves the row in both tables at once', async () => {
		setCassandraQueryExecutorForTesting(new InMemoryCassandraQueryExecutor());
		const repo = new GuildRepository();
		await repo.upsertEmoji(row(10n, 501n, 'NodNod'));
		const deps: EmojiFatesDeps = {
			guildRepository: {
				getEmojiById: (id) => repo.getEmojiById(id),
				deleteEmoji: (guild, id) => repo.deleteEmoji(guild, id),
				upsertEmoji: (r) => repo.upsertEmoji(r),
				findUnique: (async (guildId: GuildID) => ({id: guildId})) as never,
			},
			avatarService: {cloneEmojiImage: async () => {}},
		};
		await applyEmojiFates([fate({})], deps, false, '1');
		expect((await repo.getEmojiById(501n as EmojiID))?.toRow()).toMatchObject({guild_id: 20n, name: 'SeraphNod'});
		expect(await repo.listEmojis(10n as GuildID)).toEqual([]);
		expect((await repo.listEmojis(20n as GuildID)).map((e) => [e.name, e.version])).toEqual([['SeraphNod', 1]]);
	});
});
