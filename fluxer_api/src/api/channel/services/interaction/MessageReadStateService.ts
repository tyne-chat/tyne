// SPDX-License-Identifier: AGPL-3.0-or-later

import type {UserID} from '@app/api/BrandedTypes';
import type {AuthenticatedChannel} from '@app/api/channel/services/AuthenticatedChannel';
import {dispatchChannelEvent} from '@app/api/channel/services/ChannelGatewayDispatch';
import {ensureTextChannel, isOperationDisabled} from '@app/api/channel/services/message/MessageHelpers';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {Channel} from '@app/api/models/Channel';
import {GuildOperations} from '@fluxer/constants/src/GuildConstants';

// Fork imports.

import type {MessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

export class MessageReadStateService {
	constructor(private gatewayService: IGatewayService) {}
	async startTyping({
		authChannel,
		userId,
		subprofile,
	}: {
		authChannel: AuthenticatedChannel;
		userId: UserID;
		subprofile?: MessageSubprofileRequest | null;
	}): Promise<void> {
		const {channel, guild} = authChannel;
		ensureTextChannel(channel);
		if (isOperationDisabled(guild, GuildOperations.TYPING_EVENTS)) {
			return;
		}
		await this.dispatchTypingStart({channel, userId, subprofile});
	}

	private async dispatchTypingStart({
		channel,
		userId,
		subprofile,
	}: {
		channel: Channel;
		userId: UserID;
		subprofile?: MessageSubprofileRequest | null;
	}): Promise<void> {
		await dispatchChannelEvent({
			gatewayService: this.gatewayService,
			channel,
			event: 'TYPING_START',
			data: {
				channel_id: channel.id.toString(),
				user_id: userId.toString(),
				timestamp: Math.floor(Date.now() / 1000),
				subprofile: subprofile
					? {
							id: subprofile.id,
							name: subprofile.name,
							avatar: subprofile.avatar ?? null,
							avatar_color: subprofile.avatar_color ?? null,
							display_tag_text: subprofile.display_tag_text ?? null,
							display_tag_icon: subprofile.display_tag_icon ?? null,
							pronouns: subprofile.pronouns ?? null,
							color: subprofile.color ?? null,
						}
					: undefined,
			},
		});
	}
}
