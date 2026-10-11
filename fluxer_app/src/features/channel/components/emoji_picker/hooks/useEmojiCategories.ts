// SPDX-License-Identifier: AGPL-3.0-or-later

import {groupByGuildInGuildListOrder} from '@app/features/channel/components/pickers/shared/PickerRows';
import EmojiPicker from '@app/features/emoji/state/EmojiPicker';
import type {UsageRanking} from '@app/features/emoji/state/UsageFrecency';
import type {FlatEmoji, UnicodeEmoji} from '@app/features/emoji/types/EmojiTypes';
import UnicodeEmojis from '@app/features/expressions/utils/UnicodeEmojis';
import GuildList from '@app/features/guild/state/GuildList';
import SelectedGuild from '@app/features/navigation/state/SelectedGuild';
import {useMemo, useRef} from 'react';

// Fork imports.

import {compareEmojisByName} from '@app/features/emoji/utils/EmojiSortingUtils';
import Drafts from '@app/features/messaging/state/MessagingDrafts';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';

export function useEmojiCategories(
	allEmojis: ReadonlyArray<FlatEmoji | UnicodeEmoji>,
	_searchResultEmojis: ReadonlyArray<FlatEmoji | UnicodeEmoji>,
	channelId?: string,
) {
	const guilds = GuildList.guilds;
	const selectedGuildId = SelectedGuild.selectedGuildId;
	const draft = channelId ? Drafts.getDraft(channelId) : undefined;
	const effectivePersona = PersonaStore.getEffectiveReactionPersona(channelId ?? null, null, draft);
	const favoriteEmojis = EmojiPicker.getFavoriteEmojis(allEmojis as ReadonlyArray<FlatEmoji>);
	const pinnedRankingRef = useRef<UsageRanking | null>(null);
	pinnedRankingRef.current ??= EmojiPicker.getRanking();
	const pinnedRanking = pinnedRankingRef.current;
	const frequentlyUsedEmojis = useMemo(
		() => EmojiPicker.getFrecentEmojis(allEmojis as ReadonlyArray<FlatEmoji>, 42, pinnedRanking, effectivePersona?.id),
		[allEmojis, pinnedRanking, effectivePersona?.id],
	);
	const customEmojisByGuildId = useMemo(() => {
		const byGuild = groupByGuildInGuildListOrder(allEmojis);
		// Fork: custom emojis are listed A-Z within each community.
		for (const guildList of byGuild.values()) {
			guildList.sort(compareEmojisByName);
		}
		return byGuild;
	}, [allEmojis, guilds, selectedGuildId]);
	const unicodeEmojisByCategory = useMemo(() => {
		const unicodeEmojis = allEmojis.filter((emoji) => emoji.guildId == null);
		const unicodeEmojisByCategory = new Map<string, Array<FlatEmoji>>();
		for (const emoji of unicodeEmojis) {
			const category = UnicodeEmojis.getCategoryForEmoji(emoji as UnicodeEmoji)!;
			if (!unicodeEmojisByCategory.has(category)) {
				unicodeEmojisByCategory.set(category, []);
			}
			unicodeEmojisByCategory.get(category)?.push(emoji);
		}
		const categories = UnicodeEmojis.getCategories();
		const sortedUnicodeEmojisByCategory = new Map<string, Array<FlatEmoji>>();
		for (const category of categories) {
			if (unicodeEmojisByCategory.has(category)) {
				sortedUnicodeEmojisByCategory.set(
					category,
					unicodeEmojisByCategory.get(category)!.sort((a, b) => a.index! - b.index!),
				);
			}
		}
		return sortedUnicodeEmojisByCategory;
	}, [allEmojis]);
	return {
		favoriteEmojis,
		frequentlyUsedEmojis,
		customEmojisByGuildId,
		unicodeEmojisByCategory,
	};
}
