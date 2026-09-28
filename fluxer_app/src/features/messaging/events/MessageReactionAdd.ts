// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import ChannelPins from '@app/features/channel/state/ChannelPins';
import ForumPosts from '@app/features/forum/state/ForumPosts';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import GuildMembers from '@app/features/member/state/GuildMembers';
import MessageReactions from '@app/features/messaging/state/MessageReactions';
import Messages from '@app/features/messaging/state/MessagingMessages';
import SavedMessages from '@app/features/messaging/state/SavedMessages';
import type {ReactionEmoji} from '@app/features/messaging/utils/ReactionUtils';
import MentionFeed from '@app/features/notification/state/MentionFeed';
import type {GuildMemberData} from '@fluxer/schema/src/domains/guild/GuildMemberSchemas';

// Fork imports.

import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

interface ReactionEmojiPayload {
	id?: string | null;
	name?: string | null;
}

interface MessageReactionAddPayload {
	user_id: string;
	channel_id: string;
	message_id: string;
	emoji: ReactionEmojiPayload;
	guild_id?: string;
	member?: GuildMemberData;
	persona_id?: string | null;
	subprofile?: MessageSubprofileResponse | null;
}

export function handleMessageReactionAdd(data: MessageReactionAddPayload, _context: GatewayHandlerContext): void {
	const emoji = data.emoji as ReactionEmoji;
	if (data.guild_id && data.member) {
		GuildMembers.hydrateIfMissing(data.guild_id, data.member);
	}
	if (data.subprofile) {
		PersonaStore.recordKnownPersona(data.subprofile);
	}
	SavedMessages.handleMessageReactionAdd(data.message_id);
	MessageReactions.handleReactionAdd(data.message_id, data.user_id, emoji, undefined, data.persona_id, data.subprofile);
	ChannelPins.handleMessageReactionAdd(data.channel_id, data.message_id);
	ForumPosts.handleReaction(
		data.channel_id,
		data.message_id,
		emoji,
		true,
		data.user_id === Authentication.currentUserId,
	);
	MentionFeed.handleMessageReactionAdd(data.message_id);
	Messages.handleReaction({
		type: 'MESSAGE_REACTION_ADD',
		channelId: data.channel_id,
		messageId: data.message_id,
		userId: data.user_id,
		emoji,
	});
}
