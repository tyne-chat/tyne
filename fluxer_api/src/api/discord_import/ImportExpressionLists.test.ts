// SPDX-License-Identifier: AGPL-3.0-or-later

import type {EmojiID, GuildID, StickerID, UserID} from '@app/api/BrandedTypes';
import {type ExpressionListsDeps, sendExpressionLists} from '@app/api/discord_import/ImportExpressionLists';
import {GuildEmoji} from '@app/api/models/GuildEmoji';
import {GuildSticker} from '@app/api/models/GuildSticker';
import {describe, expect, it} from 'vitest';

const TEMPLE = 1523148232476065792n as GuildID;
const DEN = 1549760380840968192n as GuildID;
const OPERATOR = 1n as UserID;

const emoji = (guildId: GuildID, id: bigint, name: string) =>
	new GuildEmoji({guild_id: guildId, emoji_id: id as EmojiID, name, creator_id: OPERATOR, animated: false, version: 1});
const sticker = (guildId: GuildID, id: bigint, name: string) =>
	new GuildSticker({
		guild_id: guildId,
		sticker_id: id as StickerID,
		name,
		description: null,
		animated: true,
		tags: [],
		creator_id: OPERATOR,
		version: 1,
	});

/** A repository holding the given rows, and a gateway that records every event it is sent. */
function fakes(rows: {emojis?: Array<GuildEmoji>; stickers?: Array<GuildSticker>}) {
	const sent: Array<{guildId: GuildID; event: string; data: unknown}> = [];
	const reads: Array<string> = [];
	const deps: ExpressionListsDeps = {
		guildRepository: {
			listEmojis: async (guildId) => {
				reads.push(`emojis ${guildId}`);
				return (rows.emojis ?? []).filter((e) => e.guildId === guildId);
			},
			listStickers: async (guildId) => {
				reads.push(`stickers ${guildId}`);
				return (rows.stickers ?? []).filter((s) => s.guildId === guildId);
			},
		},
		gatewayService: {
			dispatchGuild: async ({guildId, event, data}) => {
				sent.push({guildId, event, data});
			},
		},
	};
	return {deps, sent, reads};
}

describe('sendExpressionLists', () => {
	it('sends each community its whole list once per kind, however many items the plan has', async () => {
		const {deps, sent, reads} = fakes({
			emojis: [emoji(TEMPLE, 10n, 'old'), emoji(TEMPLE, 11n, 'new'), emoji(DEN, 12n, 'den')],
			stickers: [sticker(DEN, 20n, 'Durin Wow'), sticker(DEN, 21n, 'Anaxa Sob')],
		});
		const plan = {
			emoji: [{guild_id: TEMPLE.toString()}, {guild_id: TEMPLE.toString()}, {guild_id: DEN.toString()}],
			stickers: Array.from({length: 177}, () => ({guild_id: DEN.toString()})),
		};

		const result = await sendExpressionLists(plan, deps);

		expect(result).toEqual({emoji: [TEMPLE.toString(), DEN.toString()], stickers: [DEN.toString()]});
		expect(reads).toEqual([`emojis ${TEMPLE}`, `emojis ${DEN}`, `stickers ${DEN}`]);
		expect(sent.map((s) => `${s.event} ${s.guildId}`)).toEqual([
			`GUILD_EMOJIS_UPDATE ${TEMPLE}`,
			`GUILD_EMOJIS_UPDATE ${DEN}`,
			`GUILD_STICKERS_UPDATE ${DEN}`,
		]);
		expect(sent[0].data).toEqual({
			emojis: [
				{id: '10', name: 'old', animated: false, nsfw: false},
				{id: '11', name: 'new', animated: false, nsfw: false},
			],
		});
		expect(sent[2].data).toEqual({
			stickers: [
				{id: '20', name: 'Durin Wow', description: '', tags: [], animated: true, nsfw: false},
				{id: '21', name: 'Anaxa Sob', description: '', tags: [], animated: true, nsfw: false},
			],
		});
	});

	it('sends nothing for emoji or stickers kept outside any community, or for a plan without either', async () => {
		const {deps, sent, reads} = fakes({});
		expect(
			await sendExpressionLists({emoji: [{guild_id: null}, {guild_id: null}], stickers: [{guild_id: null}]}, deps),
		).toEqual({
			emoji: [],
			stickers: [],
		});
		expect(await sendExpressionLists({emoji: [], stickers: []}, deps)).toEqual({emoji: [], stickers: []});
		expect(reads).toEqual([]);
		expect(sent).toEqual([]);
	});

	it('stops at the first failed send instead of retrying it', async () => {
		const {deps, sent} = fakes({});
		let calls = 0;
		deps.gatewayService.dispatchGuild = async () => {
			calls++;
			throw new Error('gateway unavailable');
		};
		await expect(
			sendExpressionLists({emoji: [{guild_id: TEMPLE.toString()}], stickers: [{guild_id: DEN.toString()}]}, deps),
		).rejects.toThrow('gateway unavailable');
		expect(calls).toBe(1);
		expect(sent).toEqual([]);
	});
});
