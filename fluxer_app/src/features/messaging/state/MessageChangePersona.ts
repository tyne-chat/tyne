// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import type {MessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas.js';
import {comparer, makeAutoObservable, reaction} from 'mobx';
import * as MessageCommands from '../commands/MessageCommands';
import type {Message} from '../models/MessagingMessage';
import {buildExistingAttachmentEditReferences} from '../utils/MessageEditContentUtils';

class MessageChangePersona {
	private editingMessageIds: Record<string, string> = {};

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	startChangePersona(channelId: string, messageId: string): void {
		// const currentMessageId = this.editingMessageIds[channelId];
		// const currentContent = this.editingContents[messageId];
		// if (currentMessageId === messageId && currentContent === initialContent) {
		// 	return;
		// }
		// if (currentMessageId !== messageId) {
		// 	if (currentMessageId) {
		// 		TextareaSelection.clearEditingSelection(channelId, currentMessageId);
		// 	}
		// 	this.editingMessageIds[channelId] = messageId;
		// }
		// if (currentContent !== initialContent) {
		// 	this.editingContents[messageId] = initialContent;
		// }
		this.editingMessageIds[channelId] = messageId;
	}

	stopChangingPersona(channelId: string, messageId: string): void {
		if (this.isChangingPersona(channelId, messageId)) {
			delete this.editingMessageIds[channelId];
		}
	}

	isChangingPersona(channelId: string, messageId: string): boolean {
		return this.editingMessageIds[channelId] === messageId;
	}

	async changePersona(channel: Channel, message: Message, subprofile: MessageSubprofileRequest | null): Promise<void> {
		await MessageCommands.edit(
			channel.id,
			message.id,
			message.content,
			undefined,
			message._allowedMentions,
			message.attachments?.length ? buildExistingAttachmentEditReferences(message) : undefined,
			subprofile,
		);
	}

	subscribe(callback: () => void): () => void {
		return reaction(
			() => Object.entries(this.editingMessageIds),
			() => callback(),
			{fireImmediately: true, equals: comparer.structural},
		);
	}
}

export default new MessageChangePersona();
