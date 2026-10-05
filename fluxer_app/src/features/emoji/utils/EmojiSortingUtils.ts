// SPDX-License-Identifier: AGPL-3.0-or-later

import {compare as compareSnowflakes} from '@fluxer/snowflake/src/SnowflakeUtils';

export interface NamedEmojiLike {
	readonly name: string;
	readonly id?: string;
}

/**
 * Compares two emojis alphabetically by name for universal UI ordering.
 * Uses natural alphanumeric case-insensitive comparison (`sensitivity: 'base'`, `numeric: true`).
 * Emojis whose names differ only by case, or not at all, keep newest-first order: that order decides
 * which one a typed `:name:` resolves to and which get `:name~1:`, `:name~2:`, so it must not change.
 */
export function compareEmojisByName<T extends NamedEmojiLike>(a: T, b: T): number {
	const diff = a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
	if (diff !== 0) return diff;
	return compareSnowflakes(b.id ?? null, a.id ?? null);
}
