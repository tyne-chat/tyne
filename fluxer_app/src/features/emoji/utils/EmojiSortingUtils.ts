// SPDX-License-Identifier: AGPL-3.0-or-later

export interface NamedEmojiLike {
	readonly name: string;
	readonly id?: string;
}

/**
 * Compares two emojis alphabetically by name for universal UI ordering.
 * Uses natural alphanumeric case-insensitive comparison (`sensitivity: 'base'`, `numeric: true`)
 * with deterministic fallback to exact case and ID.
 */
export function compareEmojisByName<T extends NamedEmojiLike>(a: T, b: T): number {
	const diff = a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
	if (diff !== 0) return diff;
	const exactDiff = a.name.localeCompare(b.name);
	if (exactDiff !== 0) return exactDiff;
	return (a.id ?? '').localeCompare(b.id ?? '');
}
