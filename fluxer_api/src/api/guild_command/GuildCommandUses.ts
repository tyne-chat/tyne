// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createMessageID, type GuildID} from '@app/api/BrandedTypes';
import type {GuildCommandRepository} from '@app/api/guild_command/GuildCommandRepository';
import {getGuildCommandRepository} from '@app/api/middleware/ForkServiceSingletons';
import type {Message} from '@app/api/models/Message';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

// Fork: how a message remembers the server command that made it (docs/design/server-commands.md,
// "Attaching `command` to messages"). The send path calls `recordForkGuildCommandUse` after the
// message is stored and before MESSAGE_CREATE goes out; message reads call
// `hydrateForkGuildCommandUses` from `hydratePersonas`.

interface ForkGuildCommandUse {
	guildId: GuildID;
	commandId: bigint;
	commandName: string;
}

/** The fork's options for upstream's send path; passed through `MessageRequestService.sendMessage`. */
export interface ForkSendMessageOptions {
	guildCommandUse?: ForkGuildCommandUse;
}

export async function recordForkGuildCommandUse(
	message: Message,
	fork: ForkSendMessageOptions | undefined,
	repository: GuildCommandRepository = getGuildCommandRepository(),
): Promise<void> {
	const use = fork?.guildCommandUse;
	if (!use) return;
	await repository.recordUse({
		channel_id: message.channelId,
		message_id: message.id,
		guild_id: use.guildId,
		command_id: use.commandId,
		command_name: use.commandName,
		created_at: new Date(),
	});
	channelsWithUses.set(message.channelId.toString(), {hasUses: true, at: Date.now()});
}

/** How long a channel's "no command used here" answer is trusted before it is read again. */
const CHANNEL_MARKER_TTL_MS = 10_000;
const CHANNEL_MARKER_CACHE_SIZE = 10_000;
const channelsWithUses = new Map<string, {hasUses: boolean; at: number}>();

async function channelHasUses(channelId: string, repository: GuildCommandRepository): Promise<boolean> {
	const cached = channelsWithUses.get(channelId);
	if (cached && (cached.hasUses || Date.now() - cached.at < CHANNEL_MARKER_TTL_MS)) return cached.hasUses;
	const hasUses = await repository.hasUses(createChannelID(BigInt(channelId)));
	channelsWithUses.set(channelId, {hasUses, at: Date.now()});
	if (channelsWithUses.size > CHANNEL_MARKER_CACHE_SIZE) {
		const oldest = channelsWithUses.keys().next().value;
		if (oldest !== undefined) channelsWithUses.delete(oldest);
	}
	return hasUses;
}

/** Sets `command` on messages a command made, with one query per channel where a command was ever used. */
export async function hydrateForkGuildCommandUses(
	messages: Array<MessageResponse>,
	repository: GuildCommandRepository = getGuildCommandRepository(),
): Promise<void> {
	const byChannel = new Map<string, Array<MessageResponse>>();
	for (const message of messages) {
		const list = byChannel.get(message.channel_id);
		if (list) list.push(message);
		else byChannel.set(message.channel_id, [message]);
	}
	await Promise.all(
		Array.from(byChannel, async ([channelId, channelMessages]) => {
			if (!(await channelHasUses(channelId, repository))) return;
			const uses = await repository.findUses(
				createChannelID(BigInt(channelId)),
				channelMessages.map((message) => createMessageID(BigInt(message.id))),
			);
			const byMessage = new Map(uses.map((use) => [use.message_id.toString(), use]));
			for (const message of channelMessages) {
				const use = byMessage.get(message.id);
				(message as {command?: MessageResponse['command']}).command = use
					? {id: use.command_id.toString(), guild_id: use.guild_id.toString(), name: use.command_name}
					: null;
			}
		}),
	);
}

/**
 * An edit that changes the text drops the chip: the message no longer says what the command wrote.
 * Costs nothing in channels where no command was ever used.
 */
export async function forgetForkGuildCommandUseOnEdit(
	before: Message,
	after: Message,
	repository: GuildCommandRepository = getGuildCommandRepository(),
): Promise<void> {
	if (before.content === after.content) return;
	if (!(await channelHasUses(after.channelId.toString(), repository))) return;
	await repository.deleteUse(after.channelId, after.id);
}

/** Forgets a test's cached channel markers. */
export function resetForkGuildCommandUseCache(): void {
	channelsWithUses.clear();
}
