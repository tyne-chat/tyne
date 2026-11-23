// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a `:` straight after an emoji starts the emoji search, so emoji can be typed touching each
// other (tyne-chat/tyne#650). A `:` after a letter, digit or other punctuation still does not.

import {getComposerAutocompleteReplacementStart} from '@app/features/lexical/composer/ComposerAutocompleteInsertion';
import {detectAutocompleteTrigger} from '@app/features/messaging/utils/SlashCommandUtils';
import {describe, expect, it} from 'vitest';

function emojiQuery(textUpToCursor: string): {query: string; replaceFrom: number} | null {
	const trigger = detectAutocompleteTrigger(textUpToCursor);
	if (trigger == null || trigger.type !== 'emoji') {
		return null;
	}
	return {
		query: trigger.matchedText,
		replaceFrom: getComposerAutocompleteReplacementStart(textUpToCursor, trigger.type, trigger.match),
	};
}

describe('the emoji search right after an emoji', () => {
	it('starts after a custom emoji, which the composer shows as :name:', () => {
		expect(emojiQuery(':gay::ki')).toEqual({query: 'ki', replaceFrom: 5});
		expect(emojiQuery('hello :gay::kiss_left')).toEqual({query: 'kiss_left', replaceFrom: 11});
	});

	it('starts after an emoji in the message box, which the text before the caret marks as U+FFFC', () => {
		expect(emojiQuery('\u{FFFC}\u{FFFC}:he')).toEqual({query: 'he', replaceFrom: 2});
		expect(emojiQuery('hi \u{FFFC}\u{FFFC}\u{FFFC}\u{FFFC}\u{FFFC}\u{FFFC}\u{FFFC}:kiss')).toEqual({
			query: 'kiss',
			replaceFrom: 10,
		});
		// A mention is still masked as `x`, so a `:` after it does not start the search.
		expect(emojiQuery('xxxx:he')).toBeNull();
	});

	it('starts after an emoji character', () => {
		expect(emojiQuery('😀:he')).toEqual({query: 'he', replaceFrom: 2});
		expect(emojiQuery('❤️:he')).toEqual({query: 'he', replaceFrom: 2});
		expect(emojiQuery('👍🏽:he')).toEqual({query: 'he', replaceFrom: 4});
		expect(emojiQuery('🇳🇿:he')).toEqual({query: 'he', replaceFrom: 4});
	});

	it('still needs two letters, as upstream asks', () => {
		expect(emojiQuery(':gay::k')).toBeNull();
		expect(emojiQuery('😀:h')).toBeNull();
	});

	it('does not start after a letter, a digit or other punctuation', () => {
		expect(emojiQuery('abc:de')).toBeNull();
		expect(emojiQuery('at 12:30')).toBeNull();
		expect(emojiQuery('see http://example')).toBeNull();
		expect(emojiQuery('(:sm')).toBeNull();
		expect(emojiQuery('a:b::cd')).toBeNull();
	});

	it("leaves upstream's search after a space or at the start as it was", () => {
		expect(emojiQuery(':sm')).toEqual({query: 'sm', replaceFrom: 0});
		expect(emojiQuery('hi :sm')).toEqual({query: 'sm', replaceFrom: 3});
		expect(emojiQuery(':gay: :ki')).toEqual({query: 'ki', replaceFrom: 6});
	});
});
