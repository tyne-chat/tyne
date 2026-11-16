// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: a Discord channel imported into a one-to-one DM that is not on Tyne yet (tyne-chat/tyne#685), between
// two Tyne users or a Tyne user and a placeholder the import made (tyne-chat/tyne#682). The importer creates
// it as the API's DM creation does (UserChannelService.openOneToOneDMChannel): the channel row, the pair's
// index and the DM-list entry (createDmChannelAndState), opened in each Tyne user's DM list and announced to
// them with a CHANNEL_CREATE; never for a placeholder, nobody being behind it. The id is the plan's, so a later
// import fills the same DM. After the messages, the history is marked read for those Tyne users, so years of
// it do not arrive as an unread DM.
import type {ChannelID, MessageID, UserID} from '@app/api/BrandedTypes';
import {mapChannelToResponse} from '@app/api/channel/ChannelMappers';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {UserCacheService} from '@app/api/infrastructure/UserCacheService';
import {createRequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import type {Channel} from '@app/api/models/Channel';
import type {ReadStateService} from '@app/api/read_state/ReadStateService';
import type {UserRepository} from '@app/api/user/repositories/UserRepository';

/** A new DM in the plan: its two people, and the Tyne users among them it is opened for. */
export interface PlanNewDm {
	channel_id: string;
	members: Array<string>;
	open_for: Array<string>;
}

export interface NewDmDeps {
	userRepository: Pick<
		UserRepository,
		'findUnique' | 'findExistingDmState' | 'createDmChannelAndState' | 'openPrivateChannelForUser'
	>;
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
	for (const userId of openFor) {
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
