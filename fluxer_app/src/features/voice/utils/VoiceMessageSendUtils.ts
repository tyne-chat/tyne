// SPDX-License-Identifier: AGPL-3.0-or-later

import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import {Message} from '@app/features/messaging/models/MessagingMessage';
import {UploadingAttachment} from '@app/features/messaging/models/UploadingAttachment';
import {CloudUpload} from '@app/features/messaging/upload/CloudUpload';
import {Logger} from '@app/features/platform/utils/AppLogger';
import Users from '@app/features/user/state/Users';
import {MessageFlags, MessageStates, MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';

// Fork imports.

import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {MessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

const logger = new Logger('VoiceMessageSendUtils');

export interface SendVoiceMessageParams {
	channelId: string;
	file: File;
	waveform: string;
	duration: number;
	title?: string;
	subprofile?: MessageSubprofileRequest | null;
}

export async function sendVoiceMessage(params: SendVoiceMessageParams): Promise<void> {
	const {channelId, file, waveform, duration, title} = params;
	const [uploaded] = await CloudUpload.createAndStartUploads(channelId, [file]);
	uploaded.waveform = waveform;
	uploaded.duration = duration;
	uploaded.isVoiceMessage = true;
	const nonce = SnowflakeUtils.fromTimestamp(Date.now());
	CloudUpload.claimAttachmentsForMessage(channelId, nonce, [uploaded], {
		content: '',
		flags: MessageFlags.VOICE_MESSAGE,
	});
	const currentUser = Users.getCurrentUser();
	if (!currentUser) {
		throw new Error('Current user missing');
	}
	const uploadingAttachment = UploadingAttachment.fromDescriptor({
		filename: file.name,
		title: title ?? file.name,
		size: file.size,
		contentType: file.type,
	}).toJSON();

	let subprofile: MessageSubprofileRequest | undefined | null = params.subprofile;
	if (subprofile === undefined) {
		subprofile = PersonaStore.getActiveSubprofileRequest(channelId);
		if (subprofile) {
			void PersonaStore.recordPersonaUse(subprofile.id);
		}
	}

	const optimisticSubprofile = subprofile
		? {
				id: subprofile.id,
				name: subprofile.name,
				avatar: subprofile.avatar ?? null,
				avatar_color: subprofile.avatar_color ?? null,
				display_tag_text: subprofile.display_tag_text ?? null,
				display_tag_icon: subprofile.display_tag_icon ?? null,
				pronouns: subprofile.pronouns ?? null,
				color: subprofile.color ?? null,
				bio: subprofile.bio ?? null,
				visibility: subprofile.visibility ?? null,
			}
		: null;

	const message = new Message({
		id: nonce,
		channel_id: channelId,
		author: currentUser.toJSON(),
		type: MessageTypes.DEFAULT,
		flags: MessageFlags.VOICE_MESSAGE,
		pinned: false,
		mention_everyone: false,
		content: '',
		timestamp: new Date().toISOString(),
		mentions: [],
		state: MessageStates.SENDING,
		nonce,
		attachments: [uploadingAttachment],
		subprofile: optimisticSubprofile,
	});
	MessageCommands.createOptimistic(channelId, {...message.toJSON(), attachments: [uploadingAttachment]});
	try {
		await MessageCommands.send(channelId, {
			content: '',
			nonce,
			hasAttachments: true,
			flags: MessageFlags.VOICE_MESSAGE,
			subprofile: subprofile ?? undefined,
		});
	} catch (error) {
		logger.error({error}, 'Failed to dispatch voice message');
		throw error;
	}
}
