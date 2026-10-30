// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import GuildCommandsStore from '@app/features/guild_commands/state/GuildCommandsStore';

// Fork: GUILD_COMMANDS_UPDATE only marks the community stale. Fetching on the event itself would send
// one request per member at once after any edit in a large community.
export function handleGuildCommandsUpdate(data: {guild_id: string}, _context: GatewayHandlerContext): void {
	GuildCommandsStore.markStale(data.guild_id);
}
