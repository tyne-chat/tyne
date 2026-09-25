// SPDX-License-Identifier: AGPL-3.0-or-later

import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {CloudUpload} from '@app/features/messaging/upload/CloudUpload';
import {MessageStates} from '@fluxer/constants/src/ChannelConstants';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

// Fork imports.

import {PersonaStore} from '@app/features/persona/state/PersonaStore';

export function retryFailedMessage(message: Message): boolean {
	if (!message.nonce) {
		return false;
	}
	const messageUpload = CloudUpload.getMessageUpload(message.nonce);
	const hasAttachments = messageUpload !== null;
	const optimisticMessage: WireMessage = {
		...message.toJSON(),
		state: MessageStates.SENDING,
		edited_timestamp: undefined,
		attachments: [...message.attachments],
		reactions: [],
	};
	if (message.subprofile?.id) {
		void PersonaStore.recordPersonaUse(message.subprofile.id);
	}
	MessageCommands.retryLocal(message.channelId, message.id);
	MessageCommands.createOptimistic(message.channelId, optimisticMessage);
	MessageCommands.send(message.channelId, {
		content: message.content,
		nonce: message.nonce,
		hasAttachments,
		allowedMentions: message._allowedMentions,
		messageReference: message.messageReference,
		flags: message.flags,
		favoriteMemeId: message._favoriteMemeId,
		stickers: [...(message.stickers ?? [])],
		subprofile: message.subprofile ?? undefined,
	});
	return true;
}
