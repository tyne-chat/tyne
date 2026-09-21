// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {MessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas.js';
import {compareStructural, makeAutoObservable, reaction} from 'mobx';
import * as MessageCommands from '../commands/MessageCommands';
import type {Message} from '../models/MessagingMessage';
import {buildExistingAttachmentEditReferences} from '../utils/MessageEditContentUtils';

export interface PersonaPayloadSource {
	id: string;
	name: string;
	avatarUrl?: string | null;
	color?: number | null;
	bio?: string | null;
	pronouns?: string | null;
}

class MessageChangePersona {
	private editingMessageIds: Record<string, string> = {};

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	buildSubprofilePayload(persona: PersonaPayloadSource): MessageSubprofileRequest {
		return {
			id: persona.id,
			name: persona.name,
			avatar: persona.avatarUrl ?? null,
			avatar_color: persona.color ?? null,
			color: persona.color ?? null,
			display_tag_text: PersonaStore.displayTagText || null,
			display_tag_icon: PersonaStore.displayTagIcon || null,
			system_name: PersonaStore.displayTagText || null,
			bio: persona.bio ?? null,
			pronouns: persona.pronouns ?? null,
		};
	}

	startChangePersona(channelId: string, messageId: string): void {
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
			undefined,
			undefined,
			undefined,
			message.attachments?.length ? buildExistingAttachmentEditReferences(message) : undefined,
			subprofile,
		);
	}

	subscribe(callback: () => void): () => void {
		return reaction(
			() => Object.entries(this.editingMessageIds),
			() => callback(),
			{fireImmediately: true, equals: compareStructural},
		);
	}
}

export default new MessageChangePersona();
