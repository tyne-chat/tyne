// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import Guilds from '@app/features/guild/state/Guilds';
import GuildMembers from '@app/features/member/state/GuildMembers';
import Permission from '@app/features/permissions/state/Permission';
import ThreadGuilds from '@app/features/threads/state/ThreadGuilds';
import ThreadMemberships from '@app/features/threads/state/ThreadMemberships';
import Users from '@app/features/user/state/Users';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {GuildMFALevel} from '@fluxer/constants/src/GuildConstants';
import {TEXT_THREAD_PARENT_CHANNEL_TYPES} from '@fluxer/constants/src/ThreadConstants';
import {
	canCreateThread,
	canDeleteThread,
	canJoinThread,
	canLeave,
	canRemoveThreadMember,
	canUnarchive,
	canViewThread,
	isThreadModerator,
	type ThreadActor,
	type ThreadActorContext,
	type ThreadCreateKind,
	type ThreadPatch,
	ThreadPermissionFlags,
	type ThreadWriteAction,
	threadPatchRequirement,
	threadWriteBlock,
	withImplicitThreadBits,
} from '@fluxer/constants/src/ThreadPermissionUtils';

// Fork imports.

import {
	DmThreads,
	dmThreadActor,
	isDmThreadParent,
	isDmWithoutThreads,
	isOneToOneDmThread,
} from '@app/features/threads/fork/ForkDmThreads';

function actorFor(guildId: string | undefined, permissions: bigint): ThreadActor {
	const userId = Authentication.currentUserId;
	const guild = guildId ? Guilds.getGuild(guildId) : null;
	const member = guildId && userId ? GuildMembers.getMember(guildId, userId) : null;
	const isOwner = guild != null && userId != null && guild.ownerId === userId;
	let resolved = withImplicitThreadBits(permissions);
	if (!isOwner && guild?.mfaLevel === GuildMFALevel.ELEVATED && !Users.getCurrentUser()?.mfaEnabled) {
		resolved &= ~ThreadPermissionFlags.MANAGE_THREADS;
	}
	return {
		permissions: resolved,
		isOwner,
		timedOut: member?.isTimedOut() ?? false,
	};
}

function getParentActor(parent: Channel): ThreadActor {
	// Fork: a DM or group DM (tyne-chat/tyne#699).
	if (isDmThreadParent(parent)) return dmThreadActor(parent, Authentication.currentUserId);
	return actorFor(parent.guildId, Permission.getChannelPermissions(parent.id) ?? 0n);
}

export function getThreadActorContext(thread: Channel): ThreadActorContext | null {
	if (!thread.parentId) return null;
	const parent = Channels.getChannel(thread.parentId);
	if (!parent) return null;
	const actor = getParentActor(parent);
	const metadata = thread.threadMetadata;
	return {
		...actor,
		thread: {
			type: thread.type,
			archived: metadata?.archived ?? false,
			locked: metadata?.locked ?? false,
			invitable: metadata?.invitable ?? true,
		},
		// Fork: in a 1:1 DM both people may rename and close a thread (tyne-chat/tyne#699).
		isThreadOwner:
			(thread.ownerId != null && thread.ownerId === Authentication.currentUserId) || isOneToOneDmThread(thread),
		isMember: ThreadMemberships.isMember(thread.id),
	};
}

export function isModeratorOfParent(parent: Channel): boolean {
	const actor = getParentActor(parent);
	return isThreadModerator(actor.permissions, actor);
}

export function isThreadModeratorFor(thread: Channel): boolean {
	const parent = thread.parentId ? Channels.getChannel(thread.parentId) : undefined;
	return parent != null && isModeratorOfParent(parent);
}

export function canViewThreadChannel(thread: Channel): boolean {
	const ctx = getThreadActorContext(thread);
	return ctx != null && canViewThread(ctx) === null;
}

export function canCreateThreadIn(parent: Channel, kind: ThreadCreateKind): boolean {
	if (kind === 'private' && parent.type !== ChannelTypes.GUILD_TEXT) return false;
	// Fork: the server's per-account switch for starting threads in DMs (tyne-chat/tyne#699).
	if (isDmThreadParent(parent) && (!DmThreads.canStart || isDmWithoutThreads(parent))) return false;
	return canCreateThread(getParentActor(parent), kind) === null;
}

export function canStartThreadIn(parent: Channel): boolean {
	return (
		ThreadGuilds.isActive(parent.guildId) &&
		TEXT_THREAD_PARENT_CHANNEL_TYPES.has(parent.type) &&
		(canCreateThreadIn(parent, 'public') || canCreateThreadIn(parent, 'private'))
	);
}

export function canWriteInThread(thread: Channel, action: ThreadWriteAction): boolean {
	const ctx = getThreadActorContext(thread);
	return ctx != null && threadWriteBlock(action, ctx) === null;
}

export function canPatchThread(thread: Channel, patch: ThreadPatch): boolean {
	// Fork: nobody locks a thread in a 1:1 DM; nobody could unlock it again (tyne-chat/tyne#699).
	if (patch.locked !== undefined && isOneToOneDmThread(thread)) return false;
	const ctx = getThreadActorContext(thread);
	return ctx != null && threadPatchRequirement(patch, thread.flags, ctx) === null;
}

export function canUnarchiveThread(thread: Channel): boolean {
	const ctx = getThreadActorContext(thread);
	return ctx != null && canUnarchive(ctx) === null;
}

export function canJoinThreadChannel(thread: Channel): boolean {
	const ctx = getThreadActorContext(thread);
	return ctx != null && canJoinThread(ctx) === null;
}

export function canLeaveThreadChannel(thread: Channel): boolean {
	const ctx = getThreadActorContext(thread);
	return ctx != null && canLeave(ctx) === null;
}

export function canRemoveThreadMembers(thread: Channel): boolean {
	const ctx = getThreadActorContext(thread);
	return ctx != null && canRemoveThreadMember(ctx) === null;
}

export function canDeleteThreadChannel(thread: Channel): boolean {
	// Fork: in a 1:1 DM its starter may, while nobody else has written in it; the server checks that part.
	if (isOneToOneDmThread(thread)) return thread.ownerId === Authentication.currentUserId;
	const ctx = getThreadActorContext(thread);
	return ctx != null && canDeleteThread(ctx) === null;
}
