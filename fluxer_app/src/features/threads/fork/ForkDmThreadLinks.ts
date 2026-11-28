// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a link to a thread in a DM that the app has not loaded (tyne-chat/tyne#963). READY brings no closed DM
// thread, and upstream's link renderer loads an unknown link target only for a link into a community (where only
// threads can be unknown; an `@me` link there is always a DM the app has). So a link to a closed DM thread showed
// "No access" to the other person in the DM, member of the thread or not, until something else loaded it. The
// renderer asks for it here: the channel is fetched once, and kept when it is a DM thread.
//
// How often it asks: ForkDmThreadLinkLoader.ts. Nothing else brings closed DM threads before someone opens the DM's
// thread list.

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {ResettableStates} from '@app/features/app/state/ResettableStates';
import type {Channel, ChannelWire} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {DmThreadLinkLoader} from '@app/features/threads/fork/ForkDmThreadLinkLoader';
import {isGuildlessThreadWire} from '@app/features/threads/fork/ForkDmThreads';
import ChannelThreads from '@app/features/threads/state/ChannelThreads';
import {ME} from '@fluxer/constants/src/AppConstants';
import {useEffect} from 'react';

const logger = new Logger('Threads');

export const dmThreadLinks = new DmThreadLinkLoader({
	known: (channelId) => Channels.getChannel(channelId) != null,
	fetch: async (channelId) => (await http.get<ChannelWire>(Endpoints.CHANNEL(channelId))).body,
	isDmThread: isGuildlessThreadWire,
	keep: (wire) => {
		ChannelThreads.upsert(wire);
	},
	now: () => Date.now(),
	warn: (message, error) => logger.warn(message, error),
});

ResettableStates.register(dmThreadLinks, () => dmThreadLinks.reset());

/** For LinkRenderer: load the target of an `@me` link the app does not know, in case it is a DM thread. */
export function useForkDmThreadLink(target: {scope: string; channelId: string} | null, known: Channel | null): void {
	const channelId = target && target.scope === ME && !known ? target.channelId : null;
	useEffect(() => {
		if (channelId) void dmThreadLinks.load(channelId);
	}, [channelId]);
}
