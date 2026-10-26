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
import Emoji from './Emoji';
import EmojiPicker, {getEmojiUsageKey} from './EmojiPicker';
import EmojiPins from './EmojiPins';

describe('EmojiPicker Pinning', () => {
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
		EmojiPins.reset();
	});

	describe('Global Pinning', () => {
		it('pins and unpins emojis globally', () => {
			expect(EmojiPins.isGloballyPinned(catKey)).toBe(false);
			expect(EmojiPins.isPinned(catKey)).toBe(false);

			EmojiPins.pinEmoji(catKey);
			expect(EmojiPins.isGloballyPinned(catKey)).toBe(true);
			expect(EmojiPins.isPinned(catKey)).toBe(true);
			expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual([catKey]);

			EmojiPins.unpinEmoji(catKey);
			expect(EmojiPins.isGloballyPinned(catKey)).toBe(false);
			expect(EmojiPins.isPinned(catKey)).toBe(false);
			expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual([]);
		});

		it('toggles global pin state', () => {
			EmojiPins.togglePin(dogKey);
			expect(EmojiPins.isGloballyPinned(dogKey)).toBe(true);

			EmojiPins.togglePin(dogKey);
			expect(EmojiPins.isGloballyPinned(dogKey)).toBe(false);
		});

		it('preserves insertion order of globally pinned emojis', () => {
			EmojiPins.pinEmoji(dogKey);
			EmojiPins.pinEmoji(catKey);
			EmojiPins.pinEmoji(foxKey);

			expect(EmojiPins.getGloballyPinnedEmojiKeys()).toEqual([dogKey, catKey, foxKey]);
		});
	});

	describe('Persona-Specific Pinning', () => {
		const personaA = '1001';
		const personaB = '1002';

		it('pins and unpins emojis for a specific persona', () => {
			expect(EmojiPins.isPersonaPinned(catKey, personaA)).toBe(false);
			expect(EmojiPins.isPinned(catKey, personaA)).toBe(false);

			EmojiPins.pinEmoji(catKey, personaA);
			expect(EmojiPins.isPersonaPinned(catKey, personaA)).toBe(true);
			expect(EmojiPins.isPinned(catKey, personaA)).toBe(true);
			// Does not affect global pin state
			expect(EmojiPins.isGloballyPinned(catKey)).toBe(false);
			// Does not affect persona B
			expect(EmojiPins.isPersonaPinned(catKey, personaB)).toBe(false);
			expect(EmojiPins.isPinned(catKey, personaB)).toBe(false);

			EmojiPins.unpinEmoji(catKey, personaA);
			expect(EmojiPins.isPersonaPinned(catKey, personaA)).toBe(false);
			expect(EmojiPins.isPinned(catKey, personaA)).toBe(false);
		});

		it('allows multiple personas to pin the same emoji independently', () => {
			EmojiPins.pinEmoji(starKey, personaA);
			EmojiPins.pinEmoji(starKey, personaB);

			expect(EmojiPins.isPersonaPinned(starKey, personaA)).toBe(true);
			expect(EmojiPins.isPersonaPinned(starKey, personaB)).toBe(true);

			// Unpinning for Persona A should leave Persona B intact
			EmojiPins.unpinEmoji(starKey, personaA);
			expect(EmojiPins.isPersonaPinned(starKey, personaA)).toBe(false);
			expect(EmojiPins.isPersonaPinned(starKey, personaB)).toBe(true);
		});

		it('toggles persona pin state', () => {
			EmojiPins.togglePin(foxKey, personaA);
			expect(EmojiPins.isPersonaPinned(foxKey, personaA)).toBe(true);

			EmojiPins.togglePin(foxKey, personaA);
			expect(EmojiPins.isPersonaPinned(foxKey, personaA)).toBe(false);
		});
	});

	describe('Pin Priority and Frecent Integration', () => {
		const personaId = '1003';

		it('prioritizes globally pinned emojis ahead of persona-pinned and frecents', () => {
			// Globally pinned: dog, fox
			EmojiPins.pinEmoji(dogKey);
			EmojiPins.pinEmoji(foxKey);

			// Persona pinned: star, cat
			EmojiPins.pinEmoji(starKey, personaId);
			EmojiPins.pinEmoji(catKey, personaId);

			const effectivePins = EmojiPins.getAllEffectivePinnedEmojiKeys(personaId);
			// Expected order: globally pinned first ([dog, fox]), then persona pinned ([star, cat])
			expect(effectivePins).toEqual([dogKey, foxKey, starKey, catKey]);

			// Now get frecent keys for this persona
			const frecents = EmojiPicker.getFrecentEmojiKeys(personaId);
			// Pinned emojis should appear at the very beginning in global -> persona order
			expect(frecents.slice(0, 4)).toEqual([dogKey, foxKey, starKey, catKey]);

			// In emoji picker categories (getFrecentEmojis), global pins must also appear ahead of persona pins
			const allSampleEmojis = [starEmoji, catEmoji, foxEmoji, dogEmoji];
			const frecentEmojis = EmojiPicker.getFrecentEmojis(allSampleEmojis, 42, undefined, personaId);
			expect(frecentEmojis.slice(0, 4).map((e) => e.uniqueName)).toEqual(['dog', 'fox', 'star', 'cat']);
		});

		it('deduplicates emojis pinned both globally and for a persona', () => {
			// Cat is pinned globally AND for the persona
			EmojiPins.pinEmoji(catKey);
			EmojiPins.pinEmoji(catKey, personaId);
			EmojiPins.pinEmoji(dogKey); // Globally pinned

			const effectivePins = EmojiPins.getAllEffectivePinnedEmojiKeys(personaId);
			// Cat should only appear once (at the front, since it's globally pinned)
			expect(effectivePins).toEqual([catKey, dogKey]);
		});

		it('falls back to globally pinned emojis when no persona is active', () => {
			EmojiPins.pinEmoji(dogKey);
			EmojiPins.pinEmoji(starKey);

			const effectivePins = EmojiPins.getAllEffectivePinnedEmojiKeys(null);
			expect(effectivePins).toEqual([dogKey, starKey]);

			const frecents = EmojiPicker.getFrecentEmojiKeys(null);
			expect(frecents.slice(0, 2)).toEqual([dogKey, starKey]);
		});
	});

	describe('Quick Reaction Bar Integration', () => {
		const personaId = '1004';

		it('places globally pinned emojis before persona pinned emojis at the front of quick reactions', () => {
			EmojiPins.pinEmoji('unicode:fox');
			EmojiPins.pinEmoji('unicode:cat', personaId);

			const quick = Emoji.getQuickReactionEmojis(null, 3, personaId);
			expect(quick.length).toBe(3);
			// Globally pinned first, then persona pinned
			expect(quick[0].uniqueName).toBe('fox');
			expect(quick[1].uniqueName).toBe('cat');
		});

		it('handles pinned overflow gracefully when pinned count exceeds quick reaction limit', () => {
			// Pin 4 emojis when quick bar limit is 3
			EmojiPins.pinEmoji('unicode:cat', personaId);
			EmojiPins.pinEmoji('unicode:dog', personaId);
			EmojiPins.pinEmoji('unicode:fox', personaId);
			EmojiPins.pinEmoji('unicode:heart', personaId);

			const quick = Emoji.getQuickReactionEmojis(null, 3, personaId);
			// Quick reaction bar only takes the top 3
			expect(quick.length).toBe(3);
			expect(quick.map((e) => e.uniqueName)).toEqual(['cat', 'dog', 'fox']);

			// But all 4 are available in the frecent picker list
			const frecents = EmojiPicker.getFrecentEmojiKeys(personaId);
			expect(frecents.slice(0, 4)).toEqual(['unicode:cat', 'unicode:dog', 'unicode:fox', 'unicode:heart']);
		});
	});
});
