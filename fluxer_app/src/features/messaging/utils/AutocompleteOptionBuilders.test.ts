// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import Emoji from '@app/features/emoji/state/Emoji';
import {
	AUTOCOMPLETE_EMOJI_RESULT_LIMIT,
	buildEmojiAutocompleteOptions,
	buildEmojiReactionOptions,
} from '@app/features/messaging/utils/AutocompleteOptionBuilders';

vi.mock('@app/features/emoji/state/Emoji', () => ({
	default: {
		getAllEmojis: vi.fn(() => []),
		search: vi.fn((_channel, _query, count) => {
			return Array.from({length: count || 20}, (_, i) => ({
				name: `test_emoji_${i}`,
				uniqueName: `test_emoji_${i}`,
				allNamesString: `:test_emoji_${i}:`,
			}));
		}),
	},
}));

vi.mock('@app/features/emoji/state/EmojiPicker', () => ({
	default: {
		getRanking: vi.fn(() => ({version: 1, rankedKeys: [], scoreByKey: new Map()})),
		getFrecentEmojis: vi.fn((_emojis, limit) => {
			return Array.from({length: limit}, (_, i) => ({
				name: `frecent_emoji_${i}`,
				uniqueName: `frecent_emoji_${i}`,
				allNamesString: `:frecent_emoji_${i}:`,
			}));
		}),
	},
}));

vi.mock('@app/features/expressions/utils/ExpressionPermissionUtils', () => ({
	filterEmojisForAutocomplete: vi.fn((_i18n, emojis) => emojis),
	filterStickersForAutocomplete: vi.fn((_i18n, stickers) => stickers),
}));

describe('AutocompleteOptionBuilders - Emoji Search Limit', () => {
	const mockI18n = {
		_: (descriptor: unknown) => (typeof descriptor === 'string' ? descriptor : ''),
	} as any;

	it('exports AUTOCOMPLETE_EMOJI_RESULT_LIMIT as 50', () => {
		expect(AUTOCOMPLETE_EMOJI_RESULT_LIMIT).toBe(50);
	});

	it('requests up to AUTOCOMPLETE_EMOJI_RESULT_LIMIT when searching for emoji', () => {
		const options = buildEmojiAutocompleteOptions({
			channel: null,
			matchedText: 'smile',
			i18n: mockI18n,
			prefs: {
				showDefaultEmojis: true,
				showCustomEmojis: true,
				showStickers: false,
				showMemes: false,
			},
		});

		expect(Emoji.search).toHaveBeenCalledWith(null, 'smile', AUTOCOMPLETE_EMOJI_RESULT_LIMIT);
		expect(options.length).toBe(AUTOCOMPLETE_EMOJI_RESULT_LIMIT);
	});

	it('requests up to AUTOCOMPLETE_EMOJI_RESULT_LIMIT when searching for emoji reactions', () => {
		const options = buildEmojiReactionOptions({
			channel: null,
			matchedText: 'heart',
			i18n: mockI18n,
		});

		expect(Emoji.search).toHaveBeenCalledWith(null, 'heart', AUTOCOMPLETE_EMOJI_RESULT_LIMIT);
		expect(options.length).toBe(AUTOCOMPLETE_EMOJI_RESULT_LIMIT);
	});
});
