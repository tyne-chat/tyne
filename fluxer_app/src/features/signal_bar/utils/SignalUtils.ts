// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	buildCustomEmojiURL,
	CUSTOM_EMOJI_ENLARGED_IMAGE_RUNG,
} from '@app/features/expressions/utils/CustomEmojiImageUrl';
import * as EmojiUtils from '@app/features/expressions/utils/EmojiUtils';
import Users from '@app/features/user/state/Users';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import type {ChannelSignalEntry, SignalBarSignal} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';

export function getSignalLabel(signal: SignalBarSignal): string {
	return signal.label || signal.emoji_name;
}

export function getSignalImageUrl(signal: SignalBarSignal, animated: boolean): string | null {
	if (signal.emoji_id) {
		return buildCustomEmojiURL({
			id: signal.emoji_id,
			animated: animated && signal.animated,
			size: CUSTOM_EMOJI_ENLARGED_IMAGE_RUNG,
		});
	}
	return EmojiUtils.getEmojiURL(signal.emoji_name);
}

export function getSignalEntryName(entry: ChannelSignalEntry, guildId: string | null): string {
	if (entry.subprofile) return entry.subprofile.name;
	const user = Users.getUser(entry.user.id);
	return user ? NicknameUtils.getNickname(user, guildId) : entry.user.username;
}

export function getSignalEntryKey(entry: ChannelSignalEntry): string {
	return `${entry.user.id}:${entry.persona_id ?? '0'}`;
}

export function moveSignal<T>(items: ReadonlyArray<T>, from: number, to: number): Array<T> {
	const next = [...items];
	const [moved] = next.splice(from, 1);
	if (moved !== undefined) next.splice(to, 0, moved);
	return next;
}
