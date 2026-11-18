// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildEmojiListGrouping, GuildEmojiListSort} from '@app/features/emoji/state/GuildEmojiListPrefs';
import {compareEmojisByName} from '@app/features/emoji/utils/EmojiSortingUtils';
import {compare as compareSnowflakes} from '@fluxer/snowflake/src/SnowflakeUtils';

interface ListedEmoji {
	readonly id: string;
	readonly name: string;
	readonly animated?: boolean;
}

/**
 * The sections of a community's emoji settings (tyne-chat/tyne#775). `recent` lists the newest upload
 * first, as upstream did before the fork sorted by name. With `together`, every emoji is in the first
 * section and the second is empty.
 */
export function orderGuildEmojiSections<T extends ListedEmoji>(
	emojis: ReadonlyArray<T>,
	sort: GuildEmojiListSort,
	grouping: GuildEmojiListGrouping,
): {staticEmojis: Array<T>; animatedEmojis: Array<T>} {
	const ordered = emojis
		.slice()
		.sort(sort === 'recent' ? (a, b) => compareSnowflakes(b.id, a.id) : compareEmojisByName);
	if (grouping === 'together') {
		return {staticEmojis: ordered, animatedEmojis: []};
	}
	return {
		staticEmojis: ordered.filter((emoji) => !emoji.animated),
		animatedEmojis: ordered.filter((emoji) => emoji.animated),
	};
}
