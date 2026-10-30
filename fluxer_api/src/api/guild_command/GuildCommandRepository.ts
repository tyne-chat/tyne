// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, MessageID} from '@app/api/BrandedTypes';
import {
	deleteOneOrMany,
	executeConditional,
	fetchMany,
	fetchManyInChunks,
	fetchOne,
	upsertOne,
} from '@app/api/database/CassandraQueryExecution';
import type {
	GuildCommandIdRow,
	GuildCommandRow,
	GuildCommandUseChannelRow,
	GuildCommandUseRow,
} from '@app/api/database/types/GuildCommandTypes';
import {GuildCommandIds, GuildCommands, GuildCommandUseChannels, GuildCommandUses} from '@app/api/Tables';

const LIST_GUILD_COMMANDS_CQL = GuildCommands.selectCql({where: GuildCommands.where.eq('guild_id')});

const FETCH_GUILD_COMMAND_CQL = GuildCommands.selectCql({
	where: [GuildCommands.where.eq('guild_id'), GuildCommands.where.eq('command_id')],
	limit: 1,
});

const FETCH_COMMAND_GUILD_CQL = GuildCommandIds.selectCql({where: GuildCommandIds.where.eq('command_id'), limit: 1});

const FETCH_USE_CHANNEL_CQL = GuildCommandUseChannels.selectCql({
	where: GuildCommandUseChannels.where.eq('channel_id'),
	limit: 1,
});

const FETCH_USES_CQL = GuildCommandUses.selectCql({
	where: [GuildCommandUses.where.eq('channel_id'), GuildCommandUses.where.in('message_id', 'message_ids')],
});

export class GuildCommandRepository {
	async listByGuild(guildId: GuildID): Promise<Array<GuildCommandRow>> {
		return fetchMany<GuildCommandRow>(LIST_GUILD_COMMANDS_CQL, {guild_id: guildId});
	}

	async get(guildId: GuildID, commandId: bigint): Promise<GuildCommandRow | null> {
		return fetchOne<GuildCommandRow>(FETCH_GUILD_COMMAND_CQL, {guild_id: guildId, command_id: commandId});
	}

	async findGuildId(commandId: bigint): Promise<GuildID | null> {
		const row = await fetchOne<GuildCommandIdRow>(FETCH_COMMAND_GUILD_CQL, {command_id: commandId});
		return row?.guild_id ?? null;
	}

	async save(row: GuildCommandRow): Promise<void> {
		await upsertOne(GuildCommands.upsertAll(row));
		await upsertOne(GuildCommandIds.upsertAll({command_id: row.command_id, guild_id: row.guild_id}));
	}

	async delete(guildId: GuildID, commandId: bigint): Promise<void> {
		await deleteOneOrMany(GuildCommands.deleteByPk({guild_id: guildId, command_id: commandId}));
		await deleteOneOrMany(GuildCommandIds.deleteByPk({command_id: commandId}));
	}

	/** Records that a message was made by a command. Returns false when the row already existed. */
	async recordUse(row: GuildCommandUseRow): Promise<boolean> {
		const inserted = await executeConditional(GuildCommandUses.insertIfNotExists(row));
		await executeConditional(
			GuildCommandUseChannels.insertIfNotExists({channel_id: row.channel_id, since: row.created_at}),
		);
		return inserted;
	}

	async deleteUse(channelId: ChannelID, messageId: MessageID): Promise<void> {
		await deleteOneOrMany(GuildCommandUses.deleteByPk({channel_id: channelId, message_id: messageId}));
	}

	async hasUses(channelId: ChannelID): Promise<boolean> {
		const row = await fetchOne<GuildCommandUseChannelRow>(FETCH_USE_CHANNEL_CQL, {channel_id: channelId});
		return row !== null;
	}

	async findUses(channelId: ChannelID, messageIds: Array<MessageID>): Promise<Array<GuildCommandUseRow>> {
		return fetchManyInChunks<GuildCommandUseRow, MessageID>(FETCH_USES_CQL, messageIds, (chunk) => ({
			channel_id: channelId,
			message_ids: chunk,
		}));
	}
}
