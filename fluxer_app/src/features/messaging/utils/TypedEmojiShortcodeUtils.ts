// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Emoji from '@app/features/emoji/state/Emoji';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import * as EmojiUtils from '@app/features/expressions/utils/EmojiUtils';
import {
	type AvailabilityCheck,
	checkEmojiAvailabilityWithGuildFallback,
} from '@app/features/expressions/utils/ExpressionPermissionUtils';
import UnicodeEmojis from '@app/features/expressions/utils/UnicodeEmojis';
import {findUrlSpans, isInsideSpan, type TextSpan} from '@app/features/messaging/utils/markdown/UrlSpanUtils';
import type {I18n} from '@lingui/core';

const TYPED_EMOJI_SHORTCODE_PATTERN = /:([\p{L}\p{N}_+~.-]{2,}):/gu;
const CUSTOM_EMOJI_SHORTCODE_NAME_PATTERN = /^[a-zA-Z0-9_+~-]{2,}$/;

type ShortcodeResolver = (shortcodeName: string) => string | null | undefined;

export type ResolvedTypedEmoji =
	| {
			kind: 'standard';
			name: string;
			surrogate: string;
			url: string | null;
			display: string;
	  }
	| {
			kind: 'custom';
			emojiId: string;
			animated: boolean;
			display: string;
			wire: string;
	  };

interface ResolveTypedEmojiShortcodesOptions {
	content: string;
	channel: Channel | null;
	guildIdFallback?: string | null;
	i18n: I18n;
}

function isExistingCustomEmojiMarkdown(content: string, matchIndex: number): boolean {
	return content[matchIndex - 1] === '<' || (content[matchIndex - 2] === '<' && content[matchIndex - 1] === 'a');
}

function isCustomEmoji(emoji: FlatEmoji): boolean {
	return !!emoji.id && !!emoji.guildId;
}

function isAvailable(i18n: I18n, emoji: FlatEmoji, channel: Channel | null, guildIdFallback: string | null): boolean {
	const availability: AvailabilityCheck = checkEmojiAvailabilityWithGuildFallback(
		i18n,
		emoji,
		channel,
		guildIdFallback,
	);
	return availability.canUse;
}

function replaceTypedEmojiShortcodes(content: string, resolveShortcode: ShortcodeResolver): string {
	if (!content.includes(':')) {
		return content;
	}
	let urlSpans: Array<TextSpan> | null = null;
	return content.replace(TYPED_EMOJI_SHORTCODE_PATTERN, (match, shortcodeName: string, matchIndex: number) => {
		if (isExistingCustomEmojiMarkdown(content, matchIndex)) {
			return match;
		}
		urlSpans ??= findUrlSpans(content, true);
		if (isInsideSpan(urlSpans, matchIndex)) {
			return match;
		}
		return resolveShortcode(shortcodeName) ?? match;
	});
}

export function resolveTypedEmojiShortcodes({
	content,
	channel,
	guildIdFallback = null,
	i18n,
}: ResolveTypedEmojiShortcodesOptions): string {
	return replaceTypedEmojiShortcodes(content, (shortcodeName) => {
		if (UnicodeEmojis.findEmojiByShortcodeName(shortcodeName)) {
			return null;
		}
		if (!CUSTOM_EMOJI_SHORTCODE_NAME_PATTERN.test(shortcodeName)) {
			return null;
		}
		const emoji = Emoji.findCustomEmojiForShortcode(channel, shortcodeName, guildIdFallback);
		if (emoji && isCustomEmoji(emoji) && isAvailable(i18n, emoji, channel, guildIdFallback)) {
			return Emoji.getEmojiMarkdown(emoji);
		}
		const lowerName = shortcodeName.toLowerCase();
		if (lowerName !== shortcodeName) {
			const fallbackUnicode = UnicodeEmojis.findEmojiByShortcodeName(lowerName);
			if (fallbackUnicode) {
				return fallbackUnicode.surrogates;
			}
		}
		return null;
	});
}

export function resolveTypedEmojiToken(
	shortcodeName: string,
	channel: Channel | null,
	guildIdFallback: string | null,
	i18n: I18n,
): ResolvedTypedEmoji | null {
	const exactUnicode = UnicodeEmojis.findEmojiByShortcodeName(shortcodeName);
	if (exactUnicode) {
		return {
			kind: 'standard',
			name: exactUnicode.uniqueName,
			surrogate: exactUnicode.surrogates,
			url: EmojiUtils.getEmojiURL(exactUnicode.surrogates),
			display: `:${exactUnicode.uniqueName}:`,
		};
	}
	if (!CUSTOM_EMOJI_SHORTCODE_NAME_PATTERN.test(shortcodeName)) return null;
	const emoji = Emoji.findCustomEmojiForShortcode(channel, shortcodeName, guildIdFallback);
	if (emoji && isCustomEmoji(emoji) && emoji.id && isAvailable(i18n, emoji, channel, guildIdFallback)) {
		return {
			kind: 'custom',
			emojiId: emoji.id,
			animated: Boolean(emoji.animated),
			display: `:${shortcodeName}:`,
			wire: Emoji.getEmojiMarkdown(emoji),
		};
	}
	const lowerName = shortcodeName.toLowerCase();
	if (lowerName !== shortcodeName) {
		const fallbackUnicode = UnicodeEmojis.findEmojiByShortcodeName(lowerName);
		if (fallbackUnicode) {
			return {
				kind: 'standard',
				name: fallbackUnicode.uniqueName,
				surrogate: fallbackUnicode.surrogates,
				url: EmojiUtils.getEmojiURL(fallbackUnicode.surrogates),
				display: `:${fallbackUnicode.uniqueName}:`,
			};
		}
	}
	return null;
}
