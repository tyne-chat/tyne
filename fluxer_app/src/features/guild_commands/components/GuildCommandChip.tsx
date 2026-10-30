// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import Guilds from '@app/features/guild/state/Guilds';
import styles from '@app/features/guild_commands/components/GuildCommandChip.module.css';
import GuildCommandsStore from '@app/features/guild_commands/state/GuildCommandsStore';
import * as DraftCommands from '@app/features/messaging/commands/DraftCommands';
import Drafts from '@app/features/messaging/state/MessagingDrafts';
import SessionManager from '@app/features/platform/state/AuthSession';
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import type {MessageGuildCommandResponse} from '@fluxer/schema/src/domains/guild_command/MessageGuildCommandSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';

// Fork: the chip after the timestamp of a message made by a server command
// (docs/design/server-commands.md, "The message"). Clicking it puts `/name ` in an empty message box.

const USE_COMMAND_DESCRIPTOR = msg({
	message: 'Use /{name}',
	comment: 'Tooltip on the chip that shows which community command made a message. Preserve {name}.',
});
const USE_COMMAND_FROM_DESCRIPTOR = msg({
	message: 'Use /{name} from {community}',
	comment:
		'Tooltip on the chip that shows which community command made a message, naming the community it belongs to. Preserve {name} and {community}.',
});
const CLEAR_BOX_DESCRIPTOR = msg({
	message: 'Clear the message box to use /{name}',
	comment: 'Tooltip on the community command chip when the message box already has text. Preserve {name}.',
});
const MADE_BY_COMMAND_DESCRIPTOR = msg({
	message: 'Made with /{name}',
	comment:
		'Tooltip on the community command chip when the viewer cannot use that command (not a member of its community, or the command is gone). Preserve {name}.',
});

export const GuildCommandChip = observer(function GuildCommandChip({
	command,
	channelId,
	'data-flx': dataFlx,
}: {
	command: MessageGuildCommandResponse;
	channelId: string;
	'data-flx'?: string;
}) {
	const {i18n} = useLingui();
	const channel = Channels.getChannel(channelId);
	const usable = GuildCommandsStore.resolve(channel, command.name)?.id === command.id;
	const empty = Drafts.getDraft(channelId).trim() === '';
	const community = Guilds.getGuild(command.guild_id)?.name;
	let tooltip = i18n._(USE_COMMAND_DESCRIPTOR, {name: command.name});
	if (!usable) tooltip = i18n._(MADE_BY_COMMAND_DESCRIPTOR, {name: command.name});
	else if (!empty) tooltip = i18n._(CLEAR_BOX_DESCRIPTOR, {name: command.name});
	else if (community) tooltip = i18n._(USE_COMMAND_FROM_DESCRIPTOR, {name: command.name, community});

	const onClick = () => {
		void GuildCommandsStore.ensureLoaded();
		if (!usable || Drafts.getDraft(channelId).trim() !== '') return;
		DraftCommands.createDraft(SessionManager.currentAccountKey, channelId, `/${command.name} `);
		ComponentBus.dispatch('FOCUS_TEXTAREA', {channelId});
	};

	return (
		<Tooltip text={tooltip} data-flx="guild-commands.guild-command-chip.tooltip">
			<button
				type="button"
				className={clsx(styles.chip, usable && empty && styles.usable)}
				onClick={onClick}
				aria-disabled={!usable || !empty}
				data-flx={dataFlx ?? 'guild-commands.guild-command-chip.chip'}
			>
				{`/${command.name}`}
			</button>
		</Tooltip>
	);
});
