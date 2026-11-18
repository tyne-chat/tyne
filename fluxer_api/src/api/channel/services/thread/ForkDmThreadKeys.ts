// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: how a DM thread is told apart (tyne-chat/tyne#699; ForkDmThreads.ts has the rest). Kept free of service
// imports so repositories can use it.

import {createGuildID, type GuildID} from '@app/api/BrandedTypes';
import type {Channel} from '@app/api/models/Channel';
import type {ThreadState} from '@app/api/models/ThreadState';
import {isDmThreadParentType} from '@fluxer/constants/src/ForkDmThreadConstants';
import {THREAD_CHANNEL_TYPES} from '@fluxer/constants/src/ThreadConstants';

// Upstream's thread tables type guild_id as required; DM threads are stored under 0. Their channel row has no guild.
export const DM_THREAD_GUILD_KEY: GuildID = createGuildID(0n);

export function isDmThreadGuildKey(guildId: GuildID | bigint | string | null | undefined): boolean {
	return guildId != null && BigInt(guildId) === 0n;
}

export function isDmThreadChannel(channel: Pick<Channel, 'type' | 'guildId'>): boolean {
	return THREAD_CHANNEL_TYPES.has(channel.type) && channel.guildId === null;
}

export function isDmThreadParent(channel: Pick<Channel, 'type'>): boolean {
	return isDmThreadParentType(channel.type);
}

// The key a DM thread is stored under in upstream's thread tables, or null for a guild channel.
export function dmThreadGuildKeyFor(parent: Pick<Channel, 'type'>): GuildID | null {
	return isDmThreadParentType(parent.type) ? DM_THREAD_GUILD_KEY : null;
}

export function isDmThreadState(state: Pick<ThreadState, 'guildId'>): boolean {
	return isDmThreadGuildKey(state.guildId);
}
