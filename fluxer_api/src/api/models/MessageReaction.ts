// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, EmojiID, MessageID, UserID} from '@app/api/BrandedTypes';
import type {MessageReactionRow} from '@app/api/database/types/MessageTypes';

// Fork imports.

import {createPersonaID, type PersonaID} from '@app/api/BrandedTypes';

export class MessageReaction {
	readonly channelId: ChannelID;
	readonly bucket: number;
	readonly messageId: MessageID;
	readonly userId: UserID;
	readonly emojiId: EmojiID;
	readonly emojiName: string;
	readonly isEmojiAnimated: boolean;
	readonly createdAt: Date | null;
	readonly personaId: PersonaID | null;

	constructor(row: MessageReactionRow) {
		this.channelId = row.channel_id;
		this.bucket = row.bucket;
		this.messageId = row.message_id;
		this.userId = row.user_id;
		this.emojiId = row.emoji_id;
		this.emojiName = row.emoji_name;
		this.isEmojiAnimated = row.emoji_animated ?? false;
		this.createdAt = row.created_at ?? null;
		this.personaId =
			row.persona_id !== undefined && row.persona_id !== null && row.persona_id !== 0n && row.persona_id !== '0'
				? createPersonaID(BigInt(row.persona_id))
				: null;
	}

	toRow(): MessageReactionRow {
		return {
			channel_id: this.channelId,
			bucket: this.bucket,
			message_id: this.messageId,
			user_id: this.userId,
			emoji_id: this.emojiId,
			emoji_name: this.emojiName,
			emoji_animated: this.isEmojiAnimated,
			created_at: this.createdAt,
			persona_id: this.personaId ?? createPersonaID(0n),
		};
	}
}
