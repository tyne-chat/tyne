// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildSettingsModal} from '@app/features/app/components/dialogs/LoadableSettingsModals';
import GuildSettingsModalState from '@app/features/guild/state/GuildSettingsModal';
import GuildCommandsStore from '@app/features/guild_commands/state/GuildCommandsStore';
import Permission from '@app/features/permissions/state/Permission';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import Users from '@app/features/user/state/Users';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {MessageGuildCommandResponse} from '@fluxer/schema/src/domains/guild_command/MessageGuildCommandSchemas';

// Fork: from a command's chip to that command in community settings. The tab takes the request from
// the store when it opens, so upstream's settings modal knows nothing of it.

/** Manage Commands, or Create Commands for one's own: the server's rule for changing a command. */
export function canEditGuildCommand(command: MessageGuildCommandResponse): boolean {
	const stored = GuildCommandsStore.findById(command.id);
	if (GuildCommandsStore.loaded && !stored) return false;
	const guildId = command.guild_id;
	if (Permission.can(Permissions.MANAGE_COMMANDS, {guildId})) return true;
	if (!Permission.can(Permissions.CREATE_COMMANDS, {guildId})) return false;
	return !stored || stored.creator_id === Users.getCurrentUser()?.id;
}

export function openGuildCommandInSettings(command: MessageGuildCommandResponse, onClose: () => void): void {
	const guildId = command.guild_id;
	GuildCommandsStore.requestEditing(guildId, command.id);
	if (GuildSettingsModalState.navigateToTab(guildId, 'commands')) {
		onClose();
		return;
	}
	ModalCommands.pushAfterBottomSheetClose(
		onClose,
		modal(
			() => (
				<GuildSettingsModal
					guildId={guildId}
					initialTab="commands"
					data-flx="guild-commands.open-guild-command-settings.guild-settings-modal"
				/>
			),
			'guild-settings',
		),
	);
}
