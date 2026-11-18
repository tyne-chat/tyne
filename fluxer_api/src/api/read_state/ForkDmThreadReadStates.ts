// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: read states of DM threads (tyne-chat/tyne#699). They are marked like a guild thread's (IS_THREAD), under
// DM_THREAD_GUILD_KEY, so READY can hand them to apps that know DM threads and keep them from the rest, and their
// acks travel in the DM-thread gateway envelope.

import type {ChannelID, MessageID, UserID} from '@app/api/BrandedTypes';
import {DM_THREAD_GUILD_KEY, isDmThreadGuildKey} from '@app/api/channel/services/thread/ForkDmThreadKeys';
import {SYSTEM_USER_ID} from '@app/api/constants/Core';
import type {GatewayDispatchEvent} from '@app/api/constants/Gateway';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {ReadState} from '@app/api/models/ReadState';
import type {User} from '@app/api/models/User';
import type {ReadStateChannelHint} from '@app/api/read_state/ReadStateChannelMeta';
import type {ReadStateMarker} from '@app/api/read_state/ReadStateRepository';
import type {ReadStateService} from '@app/api/read_state/ReadStateService';
import type {UserRepository} from '@app/api/user/repositories/UserRepository';
import {DM_THREAD_GATEWAY_EVENT} from '@fluxer/constants/src/ForkDmThreadConstants';
import {ReadStateFlags, THREAD_CHANNEL_TYPES} from '@fluxer/constants/src/ThreadConstants';
import {RelationshipTypes} from '@fluxer/constants/src/UserConstants';

const DM_THREAD_READ_STATE_MARKER: ReadStateMarker = {
	flags: ReadStateFlags.IS_THREAD,
	guildId: DM_THREAD_GUILD_KEY,
};

export function dmThreadReadStateMarker(channel: ReadStateChannelHint): ReadStateMarker | null {
	return channel.guildId === null && THREAD_CHANNEL_TYPES.has(channel.type) ? DM_THREAD_READ_STATE_MARKER : null;
}

export function isDmThreadReadState(readState: Pick<ReadState, 'guildId'> | null | undefined): boolean {
	return readState != null && isDmThreadGuildKey(readState.guildId);
}

// An event for one user about a DM thread, in the envelope apps that predate DM threads drop.
export async function dispatchDmThreadUserEvent(
	gatewayService: IGatewayService,
	userId: UserID,
	event: GatewayDispatchEvent,
	data: Record<string, unknown>,
): Promise<void> {
	await gatewayService.dispatchPresence({
		userId,
		event: DM_THREAD_GATEWAY_EVENT,
		data: {t: event, d: data},
	});
}

// As upstream's incrementDmMentionCounts, with the DM-thread marker on the read state it creates.
export async function incrementDmThreadMentionCounts(params: {
	readStateService: ReadStateService;
	userRepository: Pick<UserRepository, 'getRelationship'>;
	user: User | null;
	recipients: Array<User>;
	channelId: ChannelID;
	messageId: MessageID;
}): Promise<void> {
	const {readStateService, userRepository, user, recipients, channelId, messageId} = params;
	if (!user) return;
	const candidates = recipients.filter(
		(recipient) => recipient.id !== user.id && recipient.id !== SYSTEM_USER_ID && !recipient.isBot,
	);
	const blocked = await Promise.all(
		candidates.map((recipient) => userRepository.getRelationship(recipient.id, user.id, RelationshipTypes.BLOCKED)),
	);
	const updates = candidates
		.filter((_recipient, index) => !blocked[index])
		.map((recipient) => ({userId: recipient.id, channelId, messageId, marker: DM_THREAD_READ_STATE_MARKER}));
	if (updates.length > 0) await readStateService.bulkIncrementMentionCounts(updates);
}
