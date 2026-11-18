// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: renaming, moving or archiving an existing Tyne emoji during a Discord import (tyne-chat/tyne#608).
import type {EmojiID, GuildID, UserID} from '@app/api/BrandedTypes';
import type {GuildEmojiRow} from '@app/api/database/types/GuildTypes';
import {applyEmojiFates, type EmojiFatesDeps, type PlanEmojiFate} from '@app/api/discord_import/ImportEmojiFates';
import {GuildEmoji} from '@app/api/models/GuildEmoji';
import {describe, expect, it} from 'vitest';

const row = (guild: bigint, id: bigint, name: string): GuildEmojiRow => ({
	guild_id: guild as GuildID,
	emoji_id: id as EmojiID,
	name,
	creator_id: 1n as UserID,
	animated: false,
	version: 1,
});

const fate = (f: Partial<PlanEmojiFate>): PlanEmojiFate => ({
	emoji_id: '501',
	action: 'move',
	guild_id: '20',
	name: 'SeraphNod',
	from_guild_id: '10',
	old_name: 'NodNod',
	...f,
});

function fakes(rows: Array<GuildEmojiRow>) {
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
		},
	};
	return {deps, calls, byId};
}

describe('applyEmojiFates', () => {
	it('moves an emoji to another community under its new name, keeping its id and creator', async () => {
		const {deps, calls, byId} = fakes([row(10n, 501n, 'NodNod')]);
		const result = await applyEmojiFates([fate({})], deps, false, '1');
		expect(calls).toEqual(['delete 10 501', 'upsert 20 501 SeraphNod']);
		expect(byId.get(501n as EmojiID)?.creator_id).toBe(1n);
		expect(result).toEqual({guilds: ['10', '20'], done: ['501'], changed: [], missing: [], copied: []});
	});

	it('renames one in its own community without taking it off the list', async () => {
		const {deps, calls} = fakes([row(10n, 501n, 'NodNod')]);
		const result = await applyEmojiFates([fate({guild_id: '10'})], deps, false, '1');
		expect(calls).toEqual(['upsert 10 501 SeraphNod']);
		expect(result.guilds).toEqual(['10']);
	});

	it('takes one off its community list for archive-only, and counts one gone already as done', async () => {
		const {deps, calls} = fakes([row(10n, 501n, 'NodNod')]);
		const result = await applyEmojiFates(
			[
				fate({action: 'archive', guild_id: null, name: null}),
				fate({emoji_id: '502', action: 'archive', guild_id: null, name: null}),
			],
			deps,
			false,
			'1',
		);
		expect(calls).toEqual(['delete 10 501']);
		expect(result).toEqual({guilds: ['10'], done: ['501', '502'], changed: [], missing: [], copied: []});
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
		expect(result).toEqual({guilds: ['30'], done: ['501'], changed: [], missing: [], copied: ['601']});
	});

	it('counts one already where it should be as done, and writes nothing in a dry run', async () => {
		const {deps, calls} = fakes([row(20n, 501n, 'SeraphNod'), row(10n, 502n, 'NodNod')]);
		const result = await applyEmojiFates([fate({}), fate({emoji_id: '502'}), fate({emoji_id: '999'})], deps, true, '1');
		expect(calls).toEqual([]);
		expect(result).toEqual({guilds: ['10', '20'], done: ['501', '502'], changed: [], missing: ['999'], copied: []});
	});
});
