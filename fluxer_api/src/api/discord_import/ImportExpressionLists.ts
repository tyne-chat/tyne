// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: after the importer writes emoji and stickers, tell the gateway (tyne-chat/tyne#660). The
// apps get a community's emoji and stickers from the gateway, which keeps them in memory and updates
// them only from GUILD_EMOJIS_UPDATE and GUILD_STICKERS_UPDATE; the importer writes rows directly, so
// without these events its emoji and stickers never show up, a reload included (a deploy's gateway
// handoff keeps the old lists too). Each event carries the community's whole list from the database,
// as the API sends after any change: one per community and kind that the plan adds emoji or stickers
// to, whether this run created them or found them already there, so a run that stopped part-way and
// is applied again still sends them.
import type {GuildID} from '@app/api/BrandedTypes';
import {mapGuildEmojiToResponse, mapGuildStickerToResponse} from '@app/api/guild/GuildModel';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';

export interface ExpressionListsPlan {
	emoji: Array<{guild_id: string | null}>;
	stickers: Array<{guild_id: string | null}>;
}

export interface ExpressionListsDeps {
	guildRepository: Pick<GuildRepository, 'listEmojis' | 'listStickers'>;
	gatewayService: Pick<IGatewayService, 'dispatchGuild'>;
}

/** Sends the emoji and sticker lists of the communities the plan adds to; returns their ids. */
export async function sendExpressionLists(
	plan: ExpressionListsPlan,
	deps: ExpressionListsDeps,
): Promise<{emoji: Array<string>; stickers: Array<string>}> {
	// Emoji and stickers without a community are stored only for the messages that show them: no list to send.
	const emojiGuilds = [...new Set(plan.emoji.flatMap((e) => (e.guild_id ? [e.guild_id] : [])))];
	const stickerGuilds = [...new Set(plan.stickers.flatMap((s) => (s.guild_id ? [s.guild_id] : [])))];
	for (const guild of emojiGuilds) {
		const guildId = BigInt(guild) as GuildID;
		const emojis = await deps.guildRepository.listEmojis(guildId);
		await deps.gatewayService.dispatchGuild({
			guildId,
			event: 'GUILD_EMOJIS_UPDATE',
			data: {emojis: emojis.map(mapGuildEmojiToResponse)},
		});
	}
	for (const guild of stickerGuilds) {
		const guildId = BigInt(guild) as GuildID;
		const stickers = await deps.guildRepository.listStickers(guildId);
		await deps.gatewayService.dispatchGuild({
			guildId,
			event: 'GUILD_STICKERS_UPDATE',
			data: {stickers: stickers.map(mapGuildStickerToResponse)},
		});
	}
	return {emoji: emojiGuilds, stickers: stickerGuilds};
}
