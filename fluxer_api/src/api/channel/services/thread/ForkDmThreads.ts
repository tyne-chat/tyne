// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: threads in DMs and group DMs (tyne-chat/tyne#699). Upstream's thread code is built around a guild; these
// helpers stand in for the guild wherever a DM thread passes through it.
// - A DM thread's own channel row has no guild and no recipients. Who sees it follows the parent DM's recipients,
//   read on each use, so a group DM's joins and leaves need no copy kept in step.
// - Upstream's thread tables type guild_id as required; DM threads store DM_THREAD_GUILD_KEY (0) there.
// - Every gateway event about a DM thread goes to each recipient wrapped in DM_THREAD_GATEWAY_EVENT, so apps that
//   predate DM threads drop it instead of misreading a thread without a guild.
// - TYNE_DM_THREADS decides who may start one: unset or empty for nobody, "all" for everyone, else a comma list of
//   user ids. Threads that exist show for everyone whose app supports them.

import {type ChannelID, createChannelID, type MessageID, type UserID} from '@app/api/BrandedTypes';
import type {ChannelRepository} from '@app/api/channel/ChannelRepository';
import type {AuthenticatedChannel, AuthenticatedThread} from '@app/api/channel/services/AuthenticatedChannel';
import type {BaseChannelAuthService} from '@app/api/channel/services/BaseChannelAuthService';
import {DMPermissionValidator} from '@app/api/channel/services/DMPermissionValidator';
import {
	isDmThreadChannel,
	isDmThreadGuildKey,
	isDmThreadState,
} from '@app/api/channel/services/thread/ForkDmThreadKeys';
import {seesDmThreads} from '@app/api/channel/services/thread/ForkDmThreadViewer';
import {assertThreadAllowed} from '@app/api/channel/services/thread/ThreadDenials';
import {SYSTEM_USER_ID} from '@app/api/constants/Core';
import type {GatewayDispatchEvent} from '@app/api/constants/Gateway';
import type {ThreadViewer} from '@app/api/experiment/ChannelThreadsGate';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import {getChannelRepository, getGuildRepository, getUserRepository} from '@app/api/middleware/ServiceSingletons';
import type {Channel} from '@app/api/models/Channel';
import type {ThreadMember} from '@app/api/models/ThreadMember';
import type {User} from '@app/api/models/User';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {DM_THREAD_GATEWAY_EVENT, isDmThreadParentType} from '@fluxer/constants/src/ForkDmThreadConstants';
import {ThreadMemberFlags} from '@fluxer/constants/src/ThreadConstants';
import {
	canCreateThread,
	canViewThread,
	type ThreadActor,
	type ThreadActorContext,
	type ThreadCreateKind,
	type ThreadPatch,
	ThreadPermissionFlags,
} from '@fluxer/constants/src/ThreadPermissionUtils';
import {InvalidChannelTypeError} from '@fluxer/errors/src/domains/channel/InvalidChannelTypeError';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';

// What everyone in a DM may do with its threads; a group DM's owner is its moderator on top.
const DM_THREAD_PERMISSIONS =
	Permissions.VIEW_CHANNEL |
	Permissions.SEND_MESSAGES |
	Permissions.READ_MESSAGE_HISTORY |
	ThreadPermissionFlags.CREATE_PUBLIC_THREADS |
	ThreadPermissionFlags.SEND_MESSAGES_IN_THREADS;

export {
	dmThreadGuildKeyFor,
	isDmThreadChannel,
	isDmThreadGuildKey,
	isDmThreadParent,
	isDmThreadState,
} from '@app/api/channel/services/thread/ForkDmThreadKeys';

export function dmThreadsEnabledFor(userId: UserID): boolean {
	const setting = (process.env.TYNE_DM_THREADS ?? '').trim();
	if (setting === '') return false;
	if (setting === 'all') return true;
	return setting.split(',').some((id) => id.trim() === userId.toString());
}

async function loadDmThreadParent(
	channelRepository: ChannelRepository,
	thread: Pick<Channel, 'parentId'>,
): Promise<Channel | null> {
	if (thread.parentId == null) return null;
	const parent = await channelRepository.channelData.findUnique(thread.parentId);
	return parent && isDmThreadParentType(parent.type) ? parent : null;
}

function dmThreadParticipantIds(parent: Pick<Channel, 'recipientIds'>): Array<UserID> {
	return Array.from(parent.recipientIds).filter((id) => id !== SYSTEM_USER_ID);
}

function isGroupOwner(parent: Channel, userId: UserID): boolean {
	return parent.type === ChannelTypes.GROUP_DM && parent.ownerId === userId;
}

export function dmThreadParentActor(parent: Channel, userId: UserID): ThreadActor {
	return {permissions: DM_THREAD_PERMISSIONS, isOwner: isGroupOwner(parent, userId), timedOut: false};
}

// The channel whose DM rules apply: a DM thread's parent (who may write, blocks, new-conversation limits, its
// people), any other channel itself. A DM thread's own row has no recipients, so upstream's DM checks on it fail
// or find nobody (Gemini Carbon's review of tyne-chat/tyne#699).
export function dmRulesChannel(authChannel: Pick<AuthenticatedChannel, 'channel' | 'guild' | 'thread'>): Channel {
	if (authChannel.guild || !authChannel.thread || !isDmThreadChannel(authChannel.channel)) return authChannel.channel;
	return authChannel.thread.parent;
}

// The same for a channel alone: a DM thread's parent DM, loaded; any other channel itself.
export async function dmRulesChannelOf(channel: Channel): Promise<Channel> {
	if (!isDmThreadChannel(channel)) return channel;
	return (await loadDmThreadParent(getChannelRepository(), channel)) ?? channel;
}

// Search hits in DM threads the viewer may see: an app that knows DM threads, and a recipient of the parent DM.
// Upstream's search mapper keeps only threads with a guild (Gemini Carbon's review of tyne-chat/tyne#699).
export async function searchableDmThreads(
	channels: ReadonlyArray<Channel | null>,
	userId: UserID,
	viewer: ThreadViewer,
): Promise<Array<Channel>> {
	const threads = channels.filter((channel): channel is Channel => channel !== null && isDmThreadChannel(channel));
	if (threads.length === 0 || !seesDmThreads(viewer, null)) return [];
	const channelRepository = getChannelRepository();
	const parents = await Promise.all(threads.map((thread) => loadDmThreadParent(channelRepository, thread)));
	return threads.filter((_, i) => parents[i]?.recipientIds.has(userId) === true);
}

// Access to a DM thread: a recipient of its parent, as for the parent itself.
export async function authenticateDmThread({
	channelRepository,
	channel,
	userId,
}: {
	channelRepository: ChannelRepository;
	channel: Channel;
	userId: UserID;
}): Promise<AuthenticatedChannel> {
	const parent = await loadDmThreadParent(channelRepository, channel);
	if (!parent) throw new UnknownChannelError();
	if (userId !== SYSTEM_USER_ID) {
		if (parent.type === ChannelTypes.DM && parent.ownerId != null && parent.ownerId !== userId) {
			throw new UnknownChannelError();
		}
		if (!parent.recipientIds.has(userId)) throw new UnknownChannelError();
	}
	const [state, member] = await Promise.all([
		channelRepository.threads.getState(channel.id),
		channelRepository.threads.getMember(channel.id, userId),
	]);
	if (!state) throw new UnknownChannelError();
	const actor: ThreadActorContext = {
		...dmThreadParentActor(parent, userId),
		thread: {type: state.type, archived: state.archived, locked: state.locked, invitable: state.invitable ?? true},
		// In a 1:1 DM both people may rename and close a thread, as its starter may in a guild.
		isThreadOwner: parent.type === ChannelTypes.DM || channel.ownerId === userId,
		isMember: member !== null,
	};
	if (canViewThread(actor) !== null) throw new UnknownChannelError();
	const thread: AuthenticatedThread = {
		state,
		parent,
		member,
		parentPermissions: DM_THREAD_PERMISSIONS,
		actor,
		isModerator: actor.isOwner,
		enforceMfa: () => {},
	};
	return {
		channel,
		guild: null,
		member: null,
		hasPermission: async () => true,
		checkPermission: async () => {},
		thread,
	};
}

// Starting a thread in a DM: public only, the account switch, and the DM's own rules for sending.
export async function authorizeDmThreadParent({
	channelAuth,
	parentAuth,
	user,
	kind,
}: {
	channelAuth: BaseChannelAuthService;
	parentAuth: AuthenticatedChannel;
	user: User;
	kind: ThreadCreateKind;
}): Promise<AuthenticatedChannel> {
	if (kind !== 'public' && kind !== 'from_message') throw new InvalidChannelTypeError();
	if (!dmThreadsEnabledFor(user.id)) throw new MissingPermissionsError();
	await channelAuth.validateDMSendPermissions({channel: parentAuth.channel, userId: user.id});
	assertThreadAllowed(canCreateThread(dmThreadParentActor(parentAuth.channel, user.id), kind));
	return parentAuth;
}

// Everyone in the DM follows a new thread; the starter has already been added by upstream's code.
export function addDmThreadParticipants(members: Array<{userId: UserID; flags: number}>, parent: Channel): void {
	const present = new Set(members.map((member) => member.userId));
	for (const userId of dmThreadParticipantIds(parent)) {
		if (!present.has(userId)) members.push({userId, flags: 0});
	}
}

// A 1:1 DM has no moderator, so nobody may lock: a lock could never be lifted again.
export function assertDmThreadPatchAllowed(patch: ThreadPatch, thread: AuthenticatedThread): void {
	if (!isDmThreadState(thread.state)) return;
	const changesLock = patch.locked !== undefined && patch.locked !== thread.state.locked;
	if (changesLock && !thread.isModerator) throw new MissingPermissionsError();
	if (patch.rate_limit_per_user !== undefined || patch.flags !== undefined) throw new MissingPermissionsError();
}

// In a 1:1 DM, renaming or reopening a thread writes to the other person, so the DM's rules apply: not once either
// has blocked the other. Closing one stays allowed, so someone who blocked can still close it (Gemini Carbon's
// review of tyne-chat/tyne#699).
export async function assertDmThreadWriteAllowed(
	patch: ThreadPatch,
	thread: AuthenticatedThread,
	userId: UserID,
): Promise<void> {
	if (!isDmThreadState(thread.state) || thread.parent.type !== ChannelTypes.DM) return;
	if (patch.name === undefined && !(patch.archived === false && thread.state.archived)) return;
	const other = [...thread.parent.recipientIds].find((id) => id !== userId);
	if (other === undefined) return;
	const validator = new DMPermissionValidator({
		userRepository: getUserRepository(),
		guildRepository: getGuildRepository(),
	});
	await validator.validate({senderId: userId, recipientId: other});
}

// Deleting a DM thread deletes everyone's messages in it. A group DM's owner may; in a 1:1 DM the starter may
// while nobody else has written in it, as each person may delete only their own messages in a DM.
export async function assertDmThreadDeleteAllowed({
	channelRepository,
	channel,
	thread,
	userId,
}: {
	channelRepository: ChannelRepository;
	channel: Channel;
	thread: AuthenticatedThread;
	userId: UserID;
}): Promise<void> {
	if (thread.isModerator) return;
	if (thread.parent.type !== ChannelTypes.DM || channel.ownerId !== userId) throw new MissingPermissionsError();
	const members = await channelRepository.threads.getMembers(channel.id, dmThreadParticipantIds(thread.parent));
	const othersWrote = members.some(
		(member) => member.userId !== userId && (member.flags & ThreadMemberFlags.HAS_INTERACTED) !== 0,
	);
	if (othersWrote) throw new MissingPermissionsError();
	// Someone who left the thread has no member row, so nothing records that they wrote: the messages do (Gemini
	// Carbon's review).
	const othersLeft = dmThreadParticipantIds(thread.parent).some(
		(id) => id !== userId && !members.some((member) => member.userId === id),
	);
	if (othersLeft && (await someoneElseWrote(channelRepository, channel.id, userId)))
		throw new MissingPermissionsError();
}

const WROTE_PAGE = 100;
const WROTE_PAGES = 20;

// Whether anyone but `userId` wrote in the thread; past the pages read, assume so.
async function someoneElseWrote(
	channelRepository: ChannelRepository,
	channelId: ChannelID,
	userId: UserID,
): Promise<boolean> {
	let before: MessageID | undefined;
	for (let page = 0; page < WROTE_PAGES; page++) {
		const messages = await channelRepository.messages.listMessages(channelId, before, WROTE_PAGE);
		if (messages.some((m) => m.authorId !== null && m.authorId !== userId && m.authorId !== SYSTEM_USER_ID))
			return true;
		if (messages.length < WROTE_PAGE) return false;
		before = messages[messages.length - 1].id;
	}
	return true;
}

function isMutedNow(member: ThreadMember, now: number): boolean {
	if (!member.muted) return false;
	const endTime = member.muteConfig?.endTime ?? null;
	return endTime === null || endTime.getTime() > now;
}

const QUIET_MEMBER_FLAGS = ThreadMemberFlags.ONLY_MENTIONS | ThreadMemberFlags.NO_MESSAGES;

// Members who follow the thread, did not mute it and did not turn its messages down to mentions or nothing: as in
// a DM, each of their messages counts for them and is pushed to them.
async function dmThreadNotifiedMemberIds(
	channelRepository: ChannelRepository,
	threadId: ChannelID,
	candidateIds: Array<UserID>,
): Promise<Set<UserID>> {
	if (candidateIds.length === 0) return new Set();
	const now = Date.now();
	const members = await channelRepository.threads.getMembers(threadId, candidateIds);
	return new Set(
		members
			.filter((member) => !isMutedNow(member, now) && (member.flags & QUIET_MEMBER_FLAGS) === 0)
			.map((member) => member.userId),
	);
}

// For upstream's DM mention counting: the thread's notified followers instead of the thread row's (empty)
// recipients.
export async function dmThreadMentionRecipientIds(thread: Channel): Promise<Array<UserID>> {
	const channelRepository = getChannelRepository();
	const parent = await loadDmThreadParent(channelRepository, thread);
	if (!parent) return [];
	return Array.from(await dmThreadNotifiedMemberIds(channelRepository, thread.id, dmThreadParticipantIds(parent)));
}

export async function loadDmThreadParentOf(thread: Channel): Promise<Channel | null> {
	return loadDmThreadParent(getChannelRepository(), thread);
}

type Payload = Record<string, unknown>;

function isPayload(value: unknown): value is Payload {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The gateway's internal fields are for guild fan-out; a DM thread's payload goes out without them and without
// the guild key.
function publicPayload(data: unknown): unknown {
	if (!isPayload(data)) return data;
	const result: Payload = {};
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith('_fluxer_') || key.startsWith('__')) continue;
		if (key === 'guild_id' && (value === null || isDmThreadGuildKey(value as string))) continue;
		result[key] = value;
	}
	return result;
}

function wrap(event: GatewayDispatchEvent, data: unknown, extra: Payload = {}): Payload {
	return {t: event, d: data, ...extra};
}

async function dispatchWrapped(
	gatewayService: IGatewayService,
	recipients: Array<UserID>,
	build: (userId: UserID) => Payload | null,
): Promise<void> {
	await Promise.all(
		recipients.map((userId) => {
			const data = build(userId);
			if (data === null) return Promise.resolve();
			return gatewayService.dispatchPresence({userId, event: DM_THREAD_GATEWAY_EVENT, data});
		}),
	);
}

interface DmThreadEvent {
	event: GatewayDispatchEvent;
	data: unknown;
}

function threadIdsOf(events: Array<DmThreadEvent>): {threadId: string | null; parentId: string | null} {
	for (const {event, data} of events) {
		if (!isPayload(data)) continue;
		if (event === 'THREAD_CREATE' || event === 'THREAD_UPDATE' || event === 'THREAD_DELETE') {
			return {threadId: String(data.id), parentId: data.parent_id == null ? null : String(data.parent_id)};
		}
		if (event === 'THREAD_MEMBERS_UPDATE' && isPayload(data._fluxer_thread)) {
			return {threadId: String(data.id), parentId: String(data._fluxer_thread.parent_id)};
		}
		if (event === 'THREAD_MEMBER_UPDATE') {
			return {threadId: String(data.id), parentId: String(data._fluxer_parent_id)};
		}
	}
	return {threadId: null, parentId: null};
}

// Upstream's thread events for a DM thread (dispatchThreadEvents hands them here): each goes to every recipient
// of the parent, a member's own THREAD_MEMBER_UPDATE only to that member, and THREAD_CREATE / THREAD_UPDATE carry
// the receiving recipient's own `member` when they are one, as READY does for guild threads.
export async function dispatchDmThreadEvents(
	gatewayService: IGatewayService,
	events: Array<DmThreadEvent>,
): Promise<void> {
	if (events.length === 0) return;
	const channelRepository = getChannelRepository();
	const {threadId, parentId} = threadIdsOf(events);
	if (threadId === null || parentId === null) return;
	const parent = await loadDmThreadParent(channelRepository, {parentId: createChannelID(BigInt(parentId))});
	if (!parent) return;
	const recipients = dmThreadParticipantIds(parent);
	const needsMembers = events.some(({event}) => event === 'THREAD_CREATE' || event === 'THREAD_UPDATE');
	const members = needsMembers
		? await channelRepository.threads.getMembers(createChannelID(BigInt(threadId)), recipients)
		: [];
	const memberByUser = new Map(members.map((member) => [member.userId, member]));
	for (const {event, data} of events) {
		await dispatchWrapped(gatewayService, recipients, (userId) => {
			const payload = publicPayload(data);
			if (event === 'THREAD_MEMBER_UPDATE') {
				return isPayload(payload) && payload.user_id === userId.toString() ? wrap(event, payload) : null;
			}
			if ((event === 'THREAD_CREATE' || event === 'THREAD_UPDATE') && isPayload(payload)) {
				const member = memberByUser.get(userId);
				return wrap(event, member ? {...payload, member: memberPayload(member)} : payload);
			}
			return wrap(event, payload);
		});
	}
}

function memberPayload(member: ThreadMember): Payload {
	return {
		id: member.threadId.toString(),
		user_id: member.userId.toString(),
		join_timestamp: member.joinTimestamp.toISOString(),
		flags: member.flags,
		muted: member.muted,
		mute_config: member.muteConfig
			? {
					end_time: member.muteConfig.endTime?.toISOString() ?? null,
					selected_time_window: member.muteConfig.selectedTimeWindow ?? 0,
				}
			: null,
	};
}

function authorIdOf(data: unknown): string | null {
	if (!isPayload(data) || !isPayload(data.author)) return null;
	return typeof data.author.id === 'string' ? data.author.id : null;
}

// Events on a DM thread's own channel (messages, reactions, typing, pins, acks; dispatchChannelEvent hands them
// here). A new message also carries, for each follower who did not mute the thread, the copy the gateway pushes:
// a message in the parent DM, so apps that predate DM threads open the DM, with the thread for newer ones.
export async function dispatchDmThreadChannelEvent({
	gatewayService,
	channel,
	event,
	data,
}: {
	gatewayService: IGatewayService;
	channel: Channel;
	event: GatewayDispatchEvent;
	data: unknown;
}): Promise<void> {
	const channelRepository = getChannelRepository();
	const parent = await loadDmThreadParent(channelRepository, channel);
	if (!parent) return;
	const recipients = dmThreadParticipantIds(parent);
	const payload = publicPayload(data);
	let pushTargets = new Set<UserID>();
	let push: Payload | null = null;
	const authorId = event === 'MESSAGE_CREATE' ? authorIdOf(payload) : null;
	if (authorId !== null && authorId !== SYSTEM_USER_ID.toString() && isPayload(payload)) {
		const others = recipients.filter((userId) => userId.toString() !== authorId);
		pushTargets = await dmThreadNotifiedMemberIds(channelRepository, channel.id, others);
		push = {
			message: {
				...payload,
				channel_id: parent.id.toString(),
				channel_type: parent.type,
				fork_thread_id: channel.id.toString(),
				fork_thread_name: channel.name ?? '',
				// The push title's part in brackets, as the web app words it: "Thread, Group" in a named group DM.
				fork_thread_context: [channel.name, parent.type === ChannelTypes.GROUP_DM ? parent.name : null]
					.filter((part): part is string => part != null && part !== '')
					.join(', '),
			},
		};
	}
	await dispatchWrapped(gatewayService, recipients, (userId) =>
		wrap(event, payload, push !== null && pushTargets.has(userId) ? {push} : {}),
	);
}
