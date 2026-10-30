// SPDX-License-Identifier: AGPL-3.0-or-later

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import Channels from '@app/features/channel/state/Channels';
import * as CommandUtils from '@app/features/devtools/utils/CommandUtils';
import GuildCommandsStore from '@app/features/guild_commands/state/GuildCommandsStore';
import * as DraftCommands from '@app/features/messaging/commands/DraftCommands';
import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import RollingTypingSender from '@app/features/typing/rolling/RollingTypingSender';
import * as FormUtils from '@app/lib/forms';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';

// Fork: runs a server command typed in the composer (docs/design/server-commands.md, "Web client").
// The composer holds `/name input` as ordinary text; the server fills in the template and posts the
// message, which arrives like any other.

const logger = new Logger('GuildCommands');

const COMMAND_FAILED_DESCRIPTOR = msg({
	message: "Couldn't run /{name}: {detail}",
	comment:
		'Shown in the channel when a community command fails (for example slowmode or a missing permission). Preserve {name} and {detail}.',
});
const COMMAND_ONE_LINE_DESCRIPTOR = msg({
	message: 'What you type after /{name} has to fit on one line.',
	comment: 'Shown in the channel when a community command is sent with a line break in its input. Preserve {name}.',
});

/** `/name`, then optionally a space and the input. */
const COMMAND_TEXT = /^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/;
/** A retry of the same text in the same channel reuses its nonce, so a repeat cannot post twice. */
const NONCE_REUSE_MS = 120_000;

const inFlight = new Set<string>();
const lastAttempt = new Map<string, {content: string; nonce: string; at: number}>();

function nonceFor(channelId: string, content: string): string {
	const previous = lastAttempt.get(channelId);
	if (previous && previous.content === content && Date.now() - previous.at < NONCE_REUSE_MS) return previous.nonce;
	const nonce = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(0, 32);
	lastAttempt.set(channelId, {content, nonce, at: Date.now()});
	return nonce;
}

function report(channelId: string, text: string): void {
	MessageCommands.createOptimistic(channelId, CommandUtils.createSystemMessage(channelId, text).toJSON());
}

/**
 * Runs `content` as a server command when it is one. Returns false when it is not (the composer then
 * sends it as it would any text); true when it was handled, whether it was posted, refused or is
 * already running.
 */
export async function runForkGuildCommand(params: {
	channelId: string;
	content: string;
	isSlowmodeActive: boolean;
	i18n: I18n;
	setValue: (value: string) => void;
	clearSegments: () => void;
	draftOwner: DraftCommands.DraftOwner;
}): Promise<boolean> {
	const {channelId, i18n} = params;
	const content = params.content.trim();
	const match = COMMAND_TEXT.exec(content);
	if (!match) return false;
	// Built-in names cannot be community command names (the server refuses them), so a built-in never
	// resolves here.
	const name = match[1]!;
	const channel = Channels.getChannel(channelId);
	if (!channel) return false;

	await GuildCommandsStore.ensureLoaded();
	const command = GuildCommandsStore.resolve(channel, name);
	if (!command) return false;
	if (params.isSlowmodeActive) return false;

	const input = match[2] ?? '';
	if (/[\r\n]/.test(input)) {
		report(channelId, i18n._(COMMAND_ONE_LINE_DESCRIPTOR, {name}));
		return true;
	}
	if (inFlight.has(channelId)) return true;
	inFlight.add(channelId);
	try {
		const res = await http.post<WireMessage>(ForkEndpoints.CHANNEL_GUILD_COMMAND(channelId, command.id), {
			body: {
				input: input === '' ? null : input,
				persona_id: PersonaStore.latchedPersonaFor(channelId)?.id ?? null,
				nonce: nonceFor(channelId, content),
			},
		});
		if (!res.ok) throw res;
		if (res.body) Messages.handleIncomingMessage({channelId, message: res.body});
		lastAttempt.delete(channelId);
		params.setValue('');
		params.clearSegments();
		DraftCommands.deleteDraft(params.draftOwner, channelId);
		RollingTypingSender.stopTyping(channelId);
	} catch (error) {
		logger.warn('Failed to run command', error);
		// The command is gone, or the user left its community: the next use reloads that community.
		if ((error as {status?: number} | null)?.status === 404) GuildCommandsStore.markStale(command.guild_id);
		report(channelId, i18n._(COMMAND_FAILED_DESCRIPTOR, {name, detail: FormUtils.extractErrorMessage(i18n, error)}));
	} finally {
		inFlight.delete(channelId);
	}
	return true;
}

/** Forgets in-flight runs and nonces; for tests. */
export function resetForkGuildCommandRuns(): void {
	inFlight.clear();
	lastAttempt.clear();
}
