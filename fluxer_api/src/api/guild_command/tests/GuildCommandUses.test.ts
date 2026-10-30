// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createGuildID, createMessageID} from '@app/api/BrandedTypes';
import {setCassandraQueryExecutorForTesting} from '@app/api/database/CassandraQueryExecution';
import {GuildCommandRepository} from '@app/api/guild_command/GuildCommandRepository';
import {
	forgetForkGuildCommandUseOnEdit,
	hydrateForkGuildCommandUses,
	recordForkGuildCommandUse,
	resetForkGuildCommandUseCache,
} from '@app/api/guild_command/GuildCommandUses';
import type {Message} from '@app/api/models/Message';
import {InMemoryCassandraQueryExecutor} from '@app/api/test/InMemoryCassandraQueryExecutor';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const QUIET_CHANNEL = '100';
const COMMAND_CHANNEL = '200';
const repository = new GuildCommandRepository();

function responses(channelId: string, ids: Array<string>): Array<MessageResponse> {
	return ids.map((id) => ({id, channel_id: channelId}) as MessageResponse);
}

function message(channelId: string, id: string, content: string): Message {
	return {
		channelId: createChannelID(BigInt(channelId)),
		id: createMessageID(BigInt(id)),
		content,
	} as Message;
}

describe('command uses on messages', () => {
	let executor: InMemoryCassandraQueryExecutor;

	beforeEach(() => {
		executor = new InMemoryCassandraQueryExecutor();
		setCassandraQueryExecutorForTesting(executor);
		resetForkGuildCommandUseCache();
	});

	afterEach(() => {
		setCassandraQueryExecutorForTesting(null);
	});

	it('reads nothing but the channel marker where no command was ever used, and caches that', async () => {
		await hydrateForkGuildCommandUses(responses(QUIET_CHANNEL, ['1', '2', '3']), repository);
		await hydrateForkGuildCommandUses(responses(QUIET_CHANNEL, ['4']), repository);
		expect(executor.countStatements('select:guild_command_use_channels')).toBe(1);
		expect(executor.countStatements('select:guild_command_uses')).toBe(0);
	});

	it('looks up a page of messages with one query per channel, and marks the command messages', async () => {
		await recordForkGuildCommandUse(
			message(COMMAND_CHANNEL, '11', 'x'),
			{guildCommandUse: {guildId: createGuildID(9n), commandId: 77n, commandName: 'tuck'}},
			repository,
		);
		const page = responses(COMMAND_CHANNEL, ['10', '11', '12']);
		await hydrateForkGuildCommandUses([...page, ...responses(QUIET_CHANNEL, ['13'])], repository);

		expect(executor.countStatements('select:guild_command_uses')).toBe(1);
		expect(page.map((m) => m.command ?? null)).toEqual([null, {id: '77', guild_id: '9', name: 'tuck'}, null]);
	});

	it('records a use only once for a repeated message', async () => {
		const sent = message(COMMAND_CHANNEL, '21', 'x');
		const fork = {guildCommandUse: {guildId: createGuildID(9n), commandId: 77n, commandName: 'tuck'}};
		await recordForkGuildCommandUse(sent, fork, repository);
		expect(
			await repository.recordUse({
				channel_id: sent.channelId,
				message_id: sent.id,
				guild_id: createGuildID(9n),
				command_id: 77n,
				command_name: 'tuck',
				created_at: new Date(),
			}),
		).toBe(false);
	});

	it('drops the use when an edit changes the text, and touches nothing otherwise', async () => {
		const before = message(COMMAND_CHANNEL, '31', 'x');
		await recordForkGuildCommandUse(
			before,
			{guildCommandUse: {guildId: createGuildID(9n), commandId: 77n, commandName: 'tuck'}},
			repository,
		);
		await forgetForkGuildCommandUseOnEdit(before, message(COMMAND_CHANNEL, '31', 'x'), repository);
		await forgetForkGuildCommandUseOnEdit(
			message(QUIET_CHANNEL, '32', 'a'),
			message(QUIET_CHANNEL, '32', 'b'),
			repository,
		);
		expect(executor.countStatements('delete:guild_command_uses')).toBe(0);

		await forgetForkGuildCommandUseOnEdit(before, message(COMMAND_CHANNEL, '31', 'changed'), repository);
		expect(executor.countStatements('delete:guild_command_uses')).toBe(1);
		const page = responses(COMMAND_CHANNEL, ['31']);
		await hydrateForkGuildCommandUses(page, repository);
		expect(page[0]?.command ?? null).toBeNull();
	});
});
