// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: READY's DM threads (tyne-chat/tyne#699). Apps that know DM threads read `fork_dm_threads`; the rest
// ignore the unknown field, and DM-thread read states are left out of upstream's `read_states` so they never see
// read states for channels they cannot show.

import type {UserID} from '@app/api/BrandedTypes';
import type {ChannelRepository} from '@app/api/channel/ChannelRepository';
import {DM_THREAD_GUILD_KEY} from '@app/api/channel/services/thread/ForkDmThreadKeys';
import {dmThreadsEnabledFor} from '@app/api/channel/services/thread/ForkDmThreads';
import {mapThreadMemberToResponse, mapThreadToResponse} from '@app/api/channel/services/thread/ThreadMappers';
import {loadThreadViews} from '@app/api/channel/services/thread/ThreadViews';
import type {ReadState} from '@app/api/models/ReadState';
import {isDmThreadReadState} from '@app/api/read_state/ForkDmThreadReadStates';
import {mapReadStateResponse} from '@app/api/read_state/ReadStateResponseMapper';

// More would be a list nobody scrolls; the threads past it still arrive with their messages.
const MAX_READY_DM_THREADS = 200;

export function withoutDmThreadReadStates(readStates: Array<ReadState>): Array<ReadState> {
	return readStates.some(isDmThreadReadState) ? readStates.filter((state) => !isDmThreadReadState(state)) : readStates;
}

export async function buildDmThreadsReadyField(params: {
	channelRepository: ChannelRepository;
	userId: UserID;
	readStates: Array<ReadState>;
}): Promise<Record<string, unknown>> {
	const {channelRepository, userId} = params;
	const {threads} = channelRepository;
	const joinedIds = await threads.listJoinedThreadIds(userId, DM_THREAD_GUILD_KEY);
	const open = (await threads.getStates(joinedIds))
		.filter((state) => !state.archived)
		.sort((a, b) => (a.threadId > b.threadId ? -1 : 1))
		.slice(0, MAX_READY_DM_THREADS);
	// Membership outlives a group DM one has left; the parent's recipients decide.
	const parents = await channelRepository.channelData.listChannels([...new Set(open.map((state) => state.parentId))]);
	const inParent = new Set(parents.filter((parent) => parent.recipientIds.has(userId)).map((parent) => parent.id));
	const states = open.filter((state) => inParent.has(state.parentId));
	const [views, members] = await Promise.all([
		loadThreadViews(channelRepository, states, parents),
		Promise.all(states.map((state) => threads.getMember(state.threadId, userId))),
	]);
	const memberByThread = new Map(members.flatMap((member) => (member ? [[member.threadId, member] as const] : [])));
	return {
		enabled: dmThreadsEnabledFor(userId),
		threads: views.map((view) => {
			const member = memberByThread.get(view.state.threadId);
			return {
				...mapThreadToResponse(view),
				...(member ? {member: mapThreadMemberToResponse(member, {self: true})} : {}),
			};
		}),
		read_states: params.readStates.filter(isDmThreadReadState).map(mapReadStateResponse),
	};
}
