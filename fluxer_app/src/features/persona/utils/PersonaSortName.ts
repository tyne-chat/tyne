// SPDX-License-Identifier: AGPL-3.0-or-later

// Leading emoji and symbols, and spaces after them. Typed punctuation stays: printable ASCII is never
// skipped (tyne-chat/tyne#686).
const LEADING_DECORATION = /^[^\p{Alphabetic}\p{N}!-~]+/u;

/**
 * The name as it is filed in sorted lists: without leading emoji or symbols, so "✨Alice" sits with the
 * A's, but with leading ASCII punctuation, so "???Template" sits with "???". The mobile app's
 * `personaSortName` (persona_providers.dart) repeats this rule.
 */
export function getPersonaSortName(name: string): string {
	const trimmed = name.trim();
	return trimmed.replace(LEADING_DECORATION, '') || trimmed;
}
