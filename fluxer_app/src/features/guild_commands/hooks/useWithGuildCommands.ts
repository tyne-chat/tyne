// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import type {Command} from '@app/features/devtools/hooks/useCommands';
import Guilds from '@app/features/guild/state/Guilds';
import GuildCommandsStore from '@app/features/guild_commands/state/GuildCommandsStore';
import {reaction} from 'mobx';
import {useEffect, useMemo, useState} from 'react';

// Fork: adds the user's server commands to the composer's slash command list
// (docs/design/server-commands.md, "Web client"). Picking one inserts `/name ` as plain text, so the
// input is typed in the normal composer with working mentions and emoji; the send path reads it back
// (`runForkGuildCommand`). Only the first command of each name, by precedence, is listed: that is the
// one `/name` runs.

export function useWithGuildCommands(builtIns: Array<Command>, channel: Channel | null): Array<Command> {
	const [version, setVersion] = useState(0);
	useEffect(
		() =>
			reaction(
				() =>
					GuildCommandsStore.usableIn(channel)
						.map((command) => `${command.id}:${command.name}:${command.description}`)
						.join('|'),
				() => setVersion((value) => value + 1),
			),
		[channel],
	);
	return useMemo(() => {
		const taken = new Set(builtIns.map((command) => command.name));
		const added: Array<Command> = [];
		for (const command of GuildCommandsStore.usableIn(channel)) {
			const name = `/${command.name}`;
			if (taken.has(name)) continue;
			taken.add(name);
			const community = Guilds.getGuild(command.guild_id)?.name;
			const description = [command.description, community].filter(Boolean).join(' · ');
			added.push({type: 'action', name, description});
		}
		return added.length === 0 ? builtIns : [...builtIns, ...added];
		// `version` changes when the store's list does.
	}, [builtIns, channel, version]);
}

/** Starts loading the commands without blocking the render that asked for them. */
export function requestGuildCommands(): void {
	queueMicrotask(() => {
		void GuildCommandsStore.ensureLoaded();
	});
}
