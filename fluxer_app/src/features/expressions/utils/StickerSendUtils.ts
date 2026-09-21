// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ChannelStickerCommands from '@app/features/channel/commands/ChannelStickerCommands';
import type {GuildSticker} from '@app/features/expressions/models/GuildSticker';
import Drafts from '@app/features/messaging/state/MessagingDrafts';
import {CloudUpload} from '@app/features/messaging/upload/CloudUpload';

// Fork imports.

import {PersonaStore} from '@app/features/persona/state/PersonaStore';

export function shouldSetPendingSticker(channelId: string, currentContent?: string): boolean {
	const draft = currentContent ?? Drafts.getDraft(channelId);
	const hasAttachments = CloudUpload.getTextareaAttachments(channelId).length > 0;
	if (hasAttachments) return true;
	if (!draft || draft.trim().length === 0) return false;
	const match = PersonaStore.matchOutgoingMessage(draft, false, {allowEmptyContent: true});
	const contentAfterTags = (match.matched || match.wasEscaped ? match.strippedContent : draft).trim();
	return contentAfterTags.length > 0;
}

export function setPendingSticker(channelId: string, sticker: GuildSticker): void {
	ChannelStickerCommands.setPendingSticker(channelId, sticker);
}
