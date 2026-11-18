// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: threads in DMs and group DMs (tyne-chat/tyne#699). Upstream's thread code keys everything by guild, and a
// DM thread has none: the channel keeps no guild id, ChannelThreads indexes it under DM_THREAD_INDEX_KEY, and the
// thread rules see the actor below. Everyone in a DM may use its threads; a group DM's owner moderates; in a 1:1
// DM either person may rename or close a thread, nobody may lock one. ForkDmThreadReady.ts reads READY's
// `fork_dm_threads`; ForkDmThreadEvents.ts unwraps the gateway envelope every DM-thread event comes in.

import {ResettableStates} from '@app/features/app/state/ResettableStates';
import type {Channel, ChannelWire} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import ThreadMemberships from '@app/features/threads/state/ThreadMemberships';
import Users from '@app/features/user/state/Users';
import {ME} from '@fluxer/constants/src/AppConstants';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {isDmThreadParentType} from '@fluxer/constants/src/ForkDmThreadConstants';
import {THREAD_CHANNEL_TYPES} from '@fluxer/constants/src/ThreadConstants';
import {type ThreadActor, ThreadPermissionFlags} from '@fluxer/constants/src/ThreadPermissionUtils';
import {makeAutoObservable} from 'mobx';

export const DM_THREAD_INDEX_KEY = ME;

// What everyone in a DM may do in its threads, as in the DM itself (the phone grants the same).
const DM_THREAD_PERMISSIONS =
	Permissions.VIEW_CHANNEL |
	Permissions.SEND_MESSAGES |
	Permissions.READ_MESSAGE_HISTORY |
	Permissions.ADD_REACTIONS |
	Permissions.EMBED_LINKS |
	Permissions.ATTACH_FILES |
	Permissions.USE_EXTERNAL_EMOJIS |
	Permissions.USE_EXTERNAL_STICKERS |
	Permissions.PIN_MESSAGES |
	ThreadPermissionFlags.CREATE_PUBLIC_THREADS |
	ThreadPermissionFlags.SEND_MESSAGES_IN_THREADS;

class DmThreadsAccount {
	// This app shows threads in DMs, whatever the account switch says.
	readonly supported = true;
	// May this account start threads in DMs (the server's per-account switch, from READY).
	canStart = false;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	setCanStart(canStart: boolean): void {
		this.canStart = canStart;
	}

	reset(): void {
		this.canStart = false;
	}
}

export const DmThreads = new DmThreadsAccount();

ResettableStates.register(DmThreads, () => DmThreads.reset());

export function isGuildlessThreadWire(wire: Pick<ChannelWire, 'type' | 'guild_id' | 'parent_id'>): boolean {
	return wire.guild_id == null && THREAD_CHANNEL_TYPES.has(wire.type) && wire.parent_id != null;
}

export function isDmThreadParent(channel: Pick<Channel, 'type'> | null | undefined): boolean {
	return channel != null && isDmThreadParentType(channel.type);
}

export function isDmThread(channel: Pick<Channel, 'type' | 'guildId'> | null | undefined): boolean {
	return channel != null && THREAD_CHANNEL_TYPES.has(channel.type) && channel.guildId == null;
}

export function dmThreadParent(thread: Channel | null | undefined): Channel | undefined {
	if (!isDmThread(thread) || !thread?.parentId) return undefined;
	const parent = Channels.getChannel(thread.parentId);
	return isDmThreadParent(parent) ? parent : undefined;
}

export function isOneToOneDmThread(thread: Channel | null | undefined): boolean {
	return dmThreadParent(thread)?.type === ChannelTypes.DM;
}

// The "guild" a DM or one of its threads is navigated under: ME, as for the DM itself.
export function dmThreadRouteGuildId(channel: Channel | null | undefined): string | undefined {
	return isDmThread(channel) || isDmThreadParent(channel) ? ME : undefined;
}

// The permission store's answer for a DM thread, which has no guild to compute one from; null for any other
// channel or context. Upstream skips the store for DMs (isPrivate), which a DM thread is not.
export function dmThreadPermissionsFor(context: object): bigint | null {
	let channelId: unknown;
	if ('channelId' in context) channelId = context.channelId;
	else if ('id' in context) channelId = context.id;
	if (typeof channelId !== 'string') return null;
	return isDmThread(Channels.getChannel(channelId)) ? DM_THREAD_PERMISSIONS : null;
}

export function dmThreadActor(parent: Channel, userId: string | null): ThreadActor {
	return {
		permissions: DM_THREAD_PERMISSIONS,
		isOwner: parent.type === ChannelTypes.GROUP_DM && userId != null && parent.ownerId === userId,
		timedOut: false,
	};
}

// A notification's context for a message in a DM thread: the thread, and a group DM's name after it.
export function dmThreadNotificationContext(thread: Channel): string {
	const parent = dmThreadParent(thread);
	const groupName = parent?.type === ChannelTypes.GROUP_DM ? parent.name : null;
	return [thread.name, groupName].filter((part): part is string => part != null && part !== '').join(', ');
}

// Read states: a DM thread one follows and has not muted counts each message from someone else, as its DM does.
export function countsLikeDmMessages(channel: Channel | null | undefined): boolean {
	return (
		isDmThread(channel) &&
		channel != null &&
		ThreadMemberships.isMember(channel.id) &&
		!ThreadMemberships.isMuted(channel.id) &&
		dmThreadParent(channel) !== undefined
	);
}

// A DM with a system account or a bot cannot be replied to, so it holds no threads.
export function isDmWithoutThreads(channel: Channel | null | undefined): boolean {
	if (channel?.type !== ChannelTypes.DM) return false;
	const recipientId = channel.recipientIds[0];
	const recipient = recipientId ? Users.getUser(recipientId) : null;
	return recipient?.system === true || recipient?.bot === true;
}
