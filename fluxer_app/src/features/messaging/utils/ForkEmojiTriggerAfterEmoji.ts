// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream starts the emoji search only for a `:` at the start or after a space, so an emoji
// typed right after another (`:a::b`, `😀:b`) never offers suggestions. Emoji that have to touch,
// such as the halves of a combined picture, could not be typed with the search, and with "Add a space
// after emoji" off every emoji after the first was one (tyne-chat/tyne#650). Here a `:` straight
// after an emoji starts the search too: after an emoji in the message box, which the text before the
// caret marks as U+FFFC (forkAutocompleteScanText in composerOffsets.ts), after a `:name:` shortcode,
// or after an emoji character. A `:` after a letter, a digit or other punctuation still does not, so
// `12:30` and `http://` stay ordinary text.

import type {AutocompleteTrigger} from '@app/features/messaging/utils/SlashCommandUtils';

// Upstream's EMOJI_REGEX with a different opening: group 1 is empty (the search replaces from the
// `:`), group 2 the query, as upstream's callers read them.
const EMOJI_AFTER_EMOJI_REGEX =
	/(?<=:[\p{L}\p{N}_+~.-]{2,}:|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u{FFFC}|\u{FE0F}|\u{20E3}|\u{E007F})():([a-z0-9_+~-]{2,})$/iu;

export function detectEmojiTriggerAfterEmoji(textUpToCursor: string): AutocompleteTrigger | null {
	const match = textUpToCursor.match(EMOJI_AFTER_EMOJI_REGEX);
	if (match == null) {
		return null;
	}
	return {type: 'emoji', match, matchedText: match[2] ?? ''};
}
