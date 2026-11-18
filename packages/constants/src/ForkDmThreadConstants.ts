// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: threads in DMs and group DMs (tyne-chat/tyne#699). A DM thread is a public thread whose parent is a
// DM or group DM, with no guild. Upstream's thread code sees these parents through
// TEXT_THREAD_PARENT_CHANNEL_TYPES, which lists them first.

import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';

export const DM_THREAD_PARENT_CHANNEL_TYPES = new Set<number>([ChannelTypes.DM, ChannelTypes.GROUP_DM]);

export function isDmThreadParentType(type: number | null | undefined): boolean {
	return type != null && DM_THREAD_PARENT_CHANNEL_TYPES.has(type);
}

// Public threads only: a private thread among the people of one DM would hide nothing.
export function resolveDmThreadType(requestedType: number): number | null {
	return requestedType === ChannelTypes.PUBLIC_THREAD ? ChannelTypes.PUBLIC_THREAD : null;
}

// Every gateway event about a DM thread travels inside this one, as {t, d}, so apps that predate DM threads
// drop it instead of misreading a thread without a guild.
export const DM_THREAD_GATEWAY_EVENT = 'FORK_DM_THREAD_EVENT';

// The client feature (X-Fluxer-Features) of apps that know DM threads: REST keeps thread chips, notices and
// starter messages in DMs for them, and strips them for older apps as upstream does.
export const DM_THREADS_CLIENT_FEATURE = 'fork_dm_threads';

// READY's field with the account's DM threads: {enabled, threads, read_states}.
export const DM_THREADS_READY_FIELD = 'fork_dm_threads';
