// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, MessageID} from '@app/api/BrandedTypes';
import {
	advanceRow,
	deleteOneOrMany,
	executeConditional,
	fetchMany,
	fetchManyInChunks,
	fetchOne,
	upsertOne,
} from '@app/api/database/CassandraQueryExecution';
import type {
	GuildCommandCountRow,
	GuildCommandIdRow,
	GuildCommandRow,
	GuildCommandUseChannelRow,
	GuildCommandUseRow,
} from '@app/api/database/types/GuildCommandTypes';
import {
	GuildCommandCounts,
	GuildCommandIds,
	GuildCommands,
	GuildCommandUseChannels,
	GuildCommandUses,
} from '@app/api/Tables';

const LIST_GUILD_COMMANDS_CQL = GuildCommands.selectCql({where: GuildCommands.where.eq('guild_id')});

const FETCH_GUILD_COMMAND_CQL = GuildCommands.selectCql({
	where: [GuildCommands.where.eq('guild_id'), GuildCommands.where.eq('command_id')],
	limit: 1,
});

const FETCH_COMMAND_GUILD_CQL = GuildCommandIds.selectCql({where: GuildCommandIds.where.eq('command_id'), limit: 1});

const LIST_COUNTS_CQL = GuildCommandCounts.selectCql({
	where: [GuildCommandCounts.where.eq('guild_id'), GuildCommandCounts.where.eq('command_id')],
});

const FETCH_COUNT_CQL = GuildCommandCounts.selectCql({
	where: [
		GuildCommandCounts.where.eq('guild_id'),
		GuildCommandCounts.where.eq('command_id'),
		GuildCommandCounts.where.eq('counter_id'),
		GuildCommandCounts.where.eq('scope_key'),
	],
	limit: 1,
});

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

	async listCounts(guildId: GuildID, commandId: bigint): Promise<Array<GuildCommandCountRow>> {
		return fetchMany<GuildCommandCountRow>(LIST_COUNTS_CQL, {guild_id: guildId, command_id: commandId});
	}

	async getCount(guildId: GuildID, commandId: bigint, counterId: bigint, scopeKey: string): Promise<number> {
		const row = await fetchOne<GuildCommandCountRow>(FETCH_COUNT_CQL, {
			guild_id: guildId,
			command_id: commandId,
			counter_id: counterId,
			scope_key: scopeKey,
		});
		return row?.value ?? 0;
	}

	async setCount(
		guildId: GuildID,
		commandId: bigint,
		counterId: bigint,
		scopeKey: string,
		value: number,
	): Promise<void> {
		await upsertOne(
			GuildCommandCounts.upsertAll({
				guild_id: guildId,
				command_id: commandId,
				counter_id: counterId,
				scope_key: scopeKey,
				value,
				updated_ms: BigInt(Date.now()),
			}),
		);
	}

	/**
	 * One atomic add in the database, so concurrent runs all count. `advanceRow` needs a guard, and
	 * reports a row written even when its guard stops the change, so this guard can never stop it.
	 */
	async incrementCount(guildId: GuildID, commandId: bigint, counterId: bigint, scopeKey: string): Promise<void> {
		const pk = {guild_id: guildId, command_id: commandId, counter_id: counterId, scope_key: scopeKey};
		const updated_ms = BigInt(Date.now());
		await advanceRow(
			{
				table: GuildCommandCounts,
				pk,
				guard: {col: 'updated_ms', value: BigInt(Number.MAX_SAFE_INTEGER), orEqual: true},
				set: {},
				always: {updated_ms},
				increment: {value: 1},
				insert: {...pk, value: 1, updated_ms},
			},
			async () => {
				const value = await this.getCount(guildId, commandId, counterId, scopeKey);
				await this.setCount(guildId, commandId, counterId, scopeKey, value + 1);
				return true;
			},
		);
	}

	async deleteCounts(guildId: GuildID, commandId: bigint, counterId?: bigint): Promise<void> {
		const rows = await this.listCounts(guildId, commandId);
		await Promise.all(
			rows
				.filter((row) => counterId === undefined || row.counter_id === counterId)
				.map((row) =>
					deleteOneOrMany(
						GuildCommandCounts.deleteByPk({
							guild_id: row.guild_id,
							command_id: row.command_id,
							counter_id: row.counter_id,
							scope_key: row.scope_key,
						}),
					),
				),
		);
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
