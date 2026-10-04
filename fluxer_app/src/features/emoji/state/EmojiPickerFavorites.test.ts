// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {beforeEach, describe, expect, it, vi} from 'vitest';

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
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import type {FlatEmoji} from '../types/EmojiTypes';
import EmojiPicker, {getEmojiUsageKey} from './EmojiPicker';

describe('EmojiPicker Favorites & Reordering', () => {
	const catEmoji: FlatEmoji = {
		name: 'cat',
		surrogates: '🐱',
		uniqueName: 'cat',
		allNamesString: ':cat:',
		animated: false,
	};
	const dogEmoji: FlatEmoji = {
		name: 'dog',
		surrogates: '🐶',
		uniqueName: 'dog',
		allNamesString: ':dog:',
		animated: false,
	};
	const foxEmoji: FlatEmoji = {
		name: 'fox',
		surrogates: '🦊',
		uniqueName: 'fox',
		allNamesString: ':fox:',
		animated: false,
	};
	const starEmoji: FlatEmoji = {
		name: 'star',
		surrogates: '⭐',
		uniqueName: 'star',
		allNamesString: ':star:',
		animated: false,
	};

	const catKey = getEmojiUsageKey(catEmoji);
	const dogKey = getEmojiUsageKey(dogEmoji);
	const foxKey = getEmojiUsageKey(foxEmoji);
	const starKey = getEmojiUsageKey(starEmoji);

	beforeEach(() => {
		EmojiPicker.favoriteEmojis = [];
		(EmojiPicker as unknown as {_favoriteSet: Set<string>})._favoriteSet = new Set();
	});

	describe('Favorite Insertion Order', () => {
		it('appends new favorites to the end of the list', () => {
			EmojiPicker.toggleFavorite(catKey);
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey]);

			EmojiPicker.toggleFavorite(dogKey);
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, dogKey]);

			EmojiPicker.toggleFavorite(foxKey);
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, dogKey, foxKey]);

			EmojiPicker.toggleFavorite(starKey);
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, dogKey, foxKey, starKey]);
		});

		it('removes favorite when toggled off', () => {
			EmojiPicker.toggleFavorite(catKey);
			EmojiPicker.toggleFavorite(dogKey);
			EmojiPicker.toggleFavorite(foxKey);

			EmojiPicker.toggleFavorite(dogKey);
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, foxKey]);
			expect(EmojiPicker.isFavorite(dogEmoji)).toBe(false);
			expect(EmojiPicker.isFavorite(catEmoji)).toBe(true);
		});

		it('returns favorites matching the favoriteEmojis array order in getFavoriteEmojis', () => {
			// allEmojis in alphabetical order
			const allEmojis = [catEmoji, dogEmoji, foxEmoji, starEmoji];

			// User adds them in different order: star, dog, cat
			EmojiPicker.toggleFavorite(starKey);
			EmojiPicker.toggleFavorite(dogKey);
			EmojiPicker.toggleFavorite(catKey);

			const favorites = EmojiPicker.getFavoriteEmojis(allEmojis);
			expect(favorites.map((e) => e.name)).toEqual(['star', 'dog', 'cat']);
		});
	});

	describe('reorderFavorite', () => {
		beforeEach(() => {
			EmojiPicker.favoriteEmojis = [catKey, dogKey, foxKey, starKey];
			(EmojiPicker as unknown as {_favoriteSet: Set<string>})._favoriteSet = new Set(EmojiPicker.favoriteEmojis);
		});

		it('moves item to before target', () => {
			// Move star (last) before dog (index 1) -> [cat, star, dog, fox]
			EmojiPicker.reorderFavorite(starKey, dogKey, 'before');
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, starKey, dogKey, foxKey]);
		});

		it('moves item to after target', () => {
			// Move cat (first) after fox (index 2) -> [dog, fox, cat, star]
			EmojiPicker.reorderFavorite(catKey, foxKey, 'after');
			expect(EmojiPicker.favoriteEmojis).toEqual([dogKey, foxKey, catKey, starKey]);
		});

		it('swaps adjacent items', () => {
			// Move dog after cat -> [cat, dog, ...] unchanged
			// Move dog before cat -> [dog, cat, fox, star]
			EmojiPicker.reorderFavorite(dogKey, catKey, 'before');
			expect(EmojiPicker.favoriteEmojis).toEqual([dogKey, catKey, foxKey, starKey]);

			// Move cat after dog -> [dog, cat, fox, star]
			EmojiPicker.reorderFavorite(catKey, dogKey, 'after');
			expect(EmojiPicker.favoriteEmojis).toEqual([dogKey, catKey, foxKey, starKey]);
		});

		it('handles moving first item to last position', () => {
			EmojiPicker.reorderFavorite(catKey, starKey, 'after');
			expect(EmojiPicker.favoriteEmojis).toEqual([dogKey, foxKey, starKey, catKey]);
		});

		it('handles moving last item to first position', () => {
			EmojiPicker.reorderFavorite(starKey, catKey, 'before');
			expect(EmojiPicker.favoriteEmojis).toEqual([starKey, catKey, dogKey, foxKey]);
		});

		it('ignores reorder if sourceKey or targetKey is not in favorites', () => {
			EmojiPicker.reorderFavorite('unknownKey', dogKey, 'before');
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, dogKey, foxKey, starKey]);

			EmojiPicker.reorderFavorite(catKey, 'unknownKey', 'before');
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, dogKey, foxKey, starKey]);
		});

		it('ignores reorder if sourceKey equals targetKey', () => {
			EmojiPicker.reorderFavorite(catKey, catKey, 'before');
			expect(EmojiPicker.favoriteEmojis).toEqual([catKey, dogKey, foxKey, starKey]);
		});
	});
});
