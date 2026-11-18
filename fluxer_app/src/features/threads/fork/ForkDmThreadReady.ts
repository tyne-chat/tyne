// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: READY's DM threads (tyne-chat/tyne#699). The server sends them in `fork_dm_threads`, with their read states
// apart from upstream's `read_states`, so apps that predate DM threads never meet them.

import type {ChannelWire} from '@app/features/channel/models/Channel';
import {DmThreads} from '@app/features/threads/fork/ForkDmThreads';
import ChannelThreads from '@app/features/threads/state/ChannelThreads';
import {DM_THREADS_READY_FIELD} from '@fluxer/constants/src/ForkDmThreadConstants';

interface DmThreadsReadyField {
	enabled?: boolean;
	threads?: ReadonlyArray<ChannelWire>;
	read_states?: ReadonlyArray<unknown>;
}

function readyField(data: object): DmThreadsReadyField | null {
	const field = (data as Record<string, unknown>)[DM_THREADS_READY_FIELD];
	return typeof field === 'object' && field !== null ? (field as DmThreadsReadyField) : null;
}

// Before upstream's READY handler reads `read_states`.
export function includeDmThreadReadStates(data: {read_states?: ReadonlyArray<unknown>}): void {
	const extra = readyField(data)?.read_states ?? [];
	if (extra.length > 0) data.read_states = [...(data.read_states ?? []), ...extra];
}

export function dmThreadReadyChannels(data: object): Array<ChannelWire> {
	return (readyField(data)?.threads ?? []).map((thread) => ({...thread}));
}

// After upstream's ChannelThreads.handleGatewayReady, which keeps only the threads READY's guilds list.
export function hydrateDmThreadsFromReady(data: object): void {
	const field = readyField(data);
	DmThreads.setCanStart(field?.enabled === true);
	for (const thread of field?.threads ?? []) ChannelThreads.upsert(thread, undefined, {silent: true});
}
