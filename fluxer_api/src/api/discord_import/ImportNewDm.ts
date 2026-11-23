// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: a Discord channel imported into a one-to-one DM that is not on Tyne yet (tyne-chat/tyne#685), between
// two Tyne users or a Tyne user and a placeholder the import made (tyne-chat/tyne#682). The importer creates
// it as the API's DM creation does (UserChannelService.openOneToOneDMChannel): the channel row, the pair's
// index and the DM-list entry (createDmChannelAndState), opened in each Tyne user's DM list and announced to
// them with a CHANNEL_CREATE; never for a placeholder, nobody being behind it. The id is the plan's, so a later
// import fills the same DM. After the messages, the history is marked read for those Tyne users, so years of
// it do not arrive as an unread DM.
//
// A group DM (three people or more, Tyne users only; tyne-chat/tyne#608) is created as the API's group DM
// creation does (UserChannelService.createGroupDMChannel): the channel row with its owner, people and name, opened
// in each one's DM list and announced to them, within Tyne's limits on its size and on each person's open group
// DMs. Unlike it, nobody is asked: no friendship or "who may add me to group DMs" check, as a DM of two skips the
// API's checks on starting one, because the operator chose these people on the review page; and no "added"
// notices, which would follow years of imported history. It is found by the plan's id, group DMs of the same
// people being allowed on Tyne.
import type {ChannelID, MessageID, UserID} from '@app/api/BrandedTypes';
import {mapChannelToResponse} from '@app/api/channel/ChannelMappers';
import type {ChannelDataRepository} from '@app/api/channel/repositories/ChannelDataRepository';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {UserCacheService} from '@app/api/infrastructure/UserCacheService';
import type {LimitConfigService} from '@app/api/limits/LimitConfigService';
import {resolveLimitSafe} from '@app/api/limits/LimitConfigUtils';
import {createLimitMatchContext} from '@app/api/limits/LimitMatchContextBuilder';
import {createRequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import type {Channel} from '@app/api/models/Channel';
import type {ReadStateService} from '@app/api/read_state/ReadStateService';
import type {UserRepository} from '@app/api/user/repositories/UserRepository';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {MAX_GROUP_DM_RECIPIENTS, MAX_GROUP_DMS_PER_USER} from '@fluxer/constants/src/LimitConstants';
import {GeneralChannelNameType} from '@fluxer/schema/src/primitives/ChannelValidators';

/** A new DM in the plan: its people, and the Tyne users among them it is opened for; a group DM's owner and name. */
export interface PlanNewDm {
	channel_id: string;
	members: Array<string>;
	open_for: Array<string>;
	/** Three people or more, all Tyne users: a group DM owned by one of them (plan.py, Planner.group_owner). */
	group?: {owner_id: string; name: string | null} | null;
}

export interface NewDmDeps {
	userRepository: Pick<
		UserRepository,
		| 'findUnique'
		| 'findExistingDmState'
		| 'createDmChannelAndState'
		| 'openPrivateChannelForUser'
		| 'listPrivateChannelSummaries'
	>;
	channelRepository: {channelData: Pick<ChannelDataRepository, 'findUnique' | 'create'>};
	limitConfigService: Pick<LimitConfigService, 'getConfigSnapshot'>;
	gatewayService: Pick<IGatewayService, 'dispatchPresence'>;
	userCacheService: UserCacheService;
}

/**
 * The plan's DM: found when the two people have it already (an earlier run made it), else created. Stops when
 * they have a DM with another id, made since the plan: it never writes into a DM the plan did not name. In a
 * dry run it creates nothing; a placeholder the run would make may not exist yet.
 */
export async function createNewDm(
	plan: PlanNewDm,
	deps: NewDmDeps,
	dryRun: boolean,
): Promise<{channel: Channel | null; created: boolean}> {
	if (plan.group) return await createNewGroupDm(plan, plan.group, deps, dryRun);
	if (plan.members.length !== 2) throw new Error(`a new DM is between two people, not ${plan.members.length}`);
	const [a, b] = plan.members.map((m) => BigInt(m) as UserID);
	const channelId = BigInt(plan.channel_id) as ChannelID;
	const users = await Promise.all([deps.userRepository.findUnique(a), deps.userRepository.findUnique(b)]);
	if (users.some((u) => u == null)) {
		if (dryRun) return {channel: null, created: true};
		throw new Error(`a person of the new DM ${plan.channel_id} does not exist`);
	}
	const existing = await deps.userRepository.findExistingDmState(a, b);
	if (existing && existing.id !== channelId)
		throw new Error(
			`these two have a DM already (${existing.id}), not the plan's ${plan.channel_id}: refresh the snapshot and plan again`,
		);
	if (existing) return {channel: existing, created: false};
	if (dryRun) return {channel: null, created: true};
	// The first Tyne user's DM-list entry is written with the channel; the others' by opening it.
	const openFor = plan.open_for.map((u) => BigInt(u) as UserID);
	const first = openFor[0] ?? a;
	const channel = await deps.userRepository.createDmChannelAndState(first, first === a ? b : a, channelId);
	await openForUsers(channel, openFor, deps);
	return {channel, created: true};
}

/** Opens a new DM or group DM in these Tyne users' DM lists, and tells their apps. */
async function openForUsers(channel: Channel, userIds: Array<UserID>, deps: NewDmDeps): Promise<void> {
	for (const userId of userIds) {
		await deps.userRepository.openPrivateChannelForUser(userId, channel);
		await deps.gatewayService.dispatchPresence({
			userId,
			event: 'CHANNEL_CREATE',
			data: await mapChannelToResponse({
				channel,
				currentUserId: userId,
				userCacheService: deps.userCacheService,
				requestCache: createRequestCache(),
			}),
		});
	}
}

/**
 * The plan's group DM: found by its id when an earlier run made it, else created. Stops, writing nothing, when
 * someone in it is not on Tyne, when it is larger than its owner may make one, or when someone in it has as many
 * open group DMs as Tyne allows. A dry run checks the same and creates nothing.
 */
async function createNewGroupDm(
	plan: PlanNewDm,
	group: NonNullable<PlanNewDm['group']>,
	deps: NewDmDeps,
	dryRun: boolean,
): Promise<{channel: Channel | null; created: boolean}> {
	const members = plan.members.map((m) => BigInt(m) as UserID);
	const ownerId = BigInt(group.owner_id) as UserID;
	if (members.length < 3 || new Set(members).size !== members.length)
		throw new Error(`a new group DM is of three people or more, each once: ${plan.members.join(', ')}`);
	if (!members.includes(ownerId))
		throw new Error(`the group DM ${plan.channel_id}'s owner ${group.owner_id} is not one of its people`);
	const channelId = BigInt(plan.channel_id) as ChannelID;
	const existing = await deps.channelRepository.channelData.findUnique(channelId);
	if (existing) {
		if (existing.type !== ChannelTypes.GROUP_DM) throw new Error(`${plan.channel_id} is on Tyne, and not a group DM`);
		return {channel: existing, created: false};
	}
	const users = await Promise.all(members.map((m) => deps.userRepository.findUnique(m)));
	const missing = members.filter((_, i) => users[i] == null);
	if (missing.length) throw new Error(`not on Tyne, for the group DM ${plan.channel_id}: ${missing.join(', ')}`);
	const limits = deps.limitConfigService.getConfigSnapshot();
	const limit = (i: number, key: 'max_group_dm_recipients' | 'max_group_dms_per_user', fallback: number) =>
		resolveLimitSafe(limits, createLimitMatchContext({user: users[i]}), key, fallback);
	const size = limit(members.indexOf(ownerId), 'max_group_dm_recipients', MAX_GROUP_DM_RECIPIENTS);
	if (members.length > size) throw new Error(`a group DM holds at most ${size} people, not ${members.length}`);
	for (const [i, userId] of members.entries()) {
		const summaries = await deps.userRepository.listPrivateChannelSummaries(userId);
		const open = summaries.filter((s) => s.open && s.isGroupDm).length;
		if (open >= limit(i, 'max_group_dms_per_user', MAX_GROUP_DMS_PER_USER))
			throw new Error(
				`${userId} has as many open group DMs as Tyne allows (${open}): the group DM ${plan.channel_id} is not made`,
			);
	}
	if (dryRun) return {channel: null, created: true};
	// A name the API would refuse (nothing left once tidied) leaves it unnamed: the apps then list its people.
	const name = group.name ? GeneralChannelNameType.safeParse(group.name) : null;
	const channel = await deps.channelRepository.channelData.create({
		channel_id: channelId,
		guild_id: null,
		type: ChannelTypes.GROUP_DM,
		name: name?.success ? name.data : null,
		topic: null,
		icon_hash: null,
		url: null,
		parent_id: null,
		position: 0,
		owner_id: ownerId,
		recipient_ids: new Set(members),
		nsfw: false,
		rate_limit_per_user: 0,
		bitrate: null,
		user_limit: null,
		voice_connection_limit: null,
		rtc_region: null,
		rtc_p2p: null,
		last_message_id: null,
		last_pin_timestamp: null,
		permission_overwrites: null,
		nicks: null,
		soft_deleted: false,
		indexed_at: null,
		version: 1,
	});
	await openForUsers(
		channel,
		plan.open_for.map((u) => BigInt(u) as UserID),
		deps,
	);
	return {channel, created: true};
}

/** Marks a DM the import made read up to its last message for its Tyne users, as their own client would. */
export async function markNewDmRead(
	plan: PlanNewDm,
	lastMessageId: string,
	deps: {readStateService: Pick<ReadStateService, 'ackMessage'>},
): Promise<void> {
	for (const userId of plan.open_for) {
		await deps.readStateService.ackMessage({
			userId: BigInt(userId) as UserID,
			channelId: BigInt(plan.channel_id) as ChannelID,
			messageId: BigInt(lastMessageId) as MessageID,
			mentionCount: 0,
		});
	}
}
