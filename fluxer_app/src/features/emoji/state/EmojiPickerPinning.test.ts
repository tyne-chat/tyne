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
		localStorage.clear();
		EmojiPicker.resetPinnedEmojis();
	});

	describe('Global Pinning', () => {
		it('pins and unpins emojis globally', () => {
			expect(EmojiPicker.isGloballyPinned(catKey)).toBe(false);
			expect(EmojiPicker.isPinned(catKey)).toBe(false);

			EmojiPicker.pinEmoji(catKey);
			expect(EmojiPicker.isGloballyPinned(catKey)).toBe(true);
			expect(EmojiPicker.isPinned(catKey)).toBe(true);
			expect(EmojiPicker.getGloballyPinnedEmojiKeys()).toEqual([catKey]);

			// Verify persistence to localStorage
			const stored = JSON.parse(localStorage.getItem('fluxer_pinned_emojis') || '[]');
			expect(stored).toEqual([catKey]);

			EmojiPicker.unpinEmoji(catKey);
			expect(EmojiPicker.isGloballyPinned(catKey)).toBe(false);
			expect(EmojiPicker.isPinned(catKey)).toBe(false);
			expect(EmojiPicker.getGloballyPinnedEmojiKeys()).toEqual([]);
		});

		it('toggles global pin state', () => {
			EmojiPicker.togglePin(dogKey);
			expect(EmojiPicker.isGloballyPinned(dogKey)).toBe(true);

			EmojiPicker.togglePin(dogKey);
			expect(EmojiPicker.isGloballyPinned(dogKey)).toBe(false);
		});

		it('preserves insertion order of globally pinned emojis', () => {
			EmojiPicker.pinEmoji(dogKey);
			EmojiPicker.pinEmoji(catKey);
			EmojiPicker.pinEmoji(foxKey);

			expect(EmojiPicker.getGloballyPinnedEmojiKeys()).toEqual([dogKey, catKey, foxKey]);
		});
	});

	describe('Persona-Specific Pinning', () => {
		const personaA = 'persona-a-123';
		const personaB = 'persona-b-456';

		it('pins and unpins emojis for a specific persona', () => {
			expect(EmojiPicker.isPersonaPinned(catKey, personaA)).toBe(false);
			expect(EmojiPicker.isPinned(catKey, personaA)).toBe(false);

			EmojiPicker.pinEmoji(catKey, personaA);
			expect(EmojiPicker.isPersonaPinned(catKey, personaA)).toBe(true);
			expect(EmojiPicker.isPinned(catKey, personaA)).toBe(true);
			// Does not affect global pin state
			expect(EmojiPicker.isGloballyPinned(catKey)).toBe(false);
			// Does not affect persona B
			expect(EmojiPicker.isPersonaPinned(catKey, personaB)).toBe(false);
			expect(EmojiPicker.isPinned(catKey, personaB)).toBe(false);

			// Verify persistence to localStorage
			const stored = JSON.parse(localStorage.getItem('fluxer_persona_pinned_emojis') || '{}');
			expect(stored[personaA]).toEqual([catKey]);

			EmojiPicker.unpinEmoji(catKey, personaA);
			expect(EmojiPicker.isPersonaPinned(catKey, personaA)).toBe(false);
			expect(EmojiPicker.isPinned(catKey, personaA)).toBe(false);
		});

		it('allows multiple personas to pin the same emoji independently', () => {
			EmojiPicker.pinEmoji(starKey, personaA);
			EmojiPicker.pinEmoji(starKey, personaB);

			expect(EmojiPicker.isPersonaPinned(starKey, personaA)).toBe(true);
			expect(EmojiPicker.isPersonaPinned(starKey, personaB)).toBe(true);

			// Unpinning for Persona A should leave Persona B intact
			EmojiPicker.unpinEmoji(starKey, personaA);
			expect(EmojiPicker.isPersonaPinned(starKey, personaA)).toBe(false);
			expect(EmojiPicker.isPersonaPinned(starKey, personaB)).toBe(true);
		});

		it('toggles persona pin state', () => {
			EmojiPicker.togglePin(foxKey, personaA);
			expect(EmojiPicker.isPersonaPinned(foxKey, personaA)).toBe(true);

			EmojiPicker.togglePin(foxKey, personaA);
			expect(EmojiPicker.isPersonaPinned(foxKey, personaA)).toBe(false);
		});
	});

	describe('Pin Priority and Frecent Integration', () => {
		const personaId = 'active-persona-789';

		it('prioritizes globally pinned emojis ahead of persona-pinned and frecents', () => {
			// Globally pinned: dog, fox
			EmojiPicker.pinEmoji(dogKey);
			EmojiPicker.pinEmoji(foxKey);

			// Persona pinned: star, cat
			EmojiPicker.pinEmoji(starKey, personaId);
			EmojiPicker.pinEmoji(catKey, personaId);

			const effectivePins = EmojiPicker.getAllEffectivePinnedEmojiKeys(personaId);
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
			EmojiPicker.pinEmoji(catKey);
			EmojiPicker.pinEmoji(catKey, personaId);
			EmojiPicker.pinEmoji(dogKey); // Globally pinned

			const effectivePins = EmojiPicker.getAllEffectivePinnedEmojiKeys(personaId);
			// Cat should only appear once (at the front, since it's globally pinned)
			expect(effectivePins).toEqual([catKey, dogKey]);
		});

		it('falls back to globally pinned emojis when no persona is active', () => {
			EmojiPicker.pinEmoji(dogKey);
			EmojiPicker.pinEmoji(starKey);

			const effectivePins = EmojiPicker.getAllEffectivePinnedEmojiKeys(null);
			expect(effectivePins).toEqual([dogKey, starKey]);

			const frecents = EmojiPicker.getFrecentEmojiKeys(null);
			expect(frecents.slice(0, 2)).toEqual([dogKey, starKey]);
		});
	});

	describe('Quick Reaction Bar Integration', () => {
		const personaId = 'active-persona-123';

		it('places globally pinned emojis before persona pinned emojis at the front of quick reactions', () => {
			EmojiPicker.pinEmoji('unicode:fox');
			EmojiPicker.pinEmoji('unicode:cat', personaId);

			const quick = Emoji.getQuickReactionEmojis(null, 3, personaId);
			expect(quick.length).toBe(3);
			// Globally pinned first, then persona pinned
			expect(quick[0].uniqueName).toBe('fox');
			expect(quick[1].uniqueName).toBe('cat');
		});

		it('handles pinned overflow gracefully when pinned count exceeds quick reaction limit', () => {
			// Pin 4 emojis when quick bar limit is 3
			EmojiPicker.pinEmoji('unicode:cat', personaId);
			EmojiPicker.pinEmoji('unicode:dog', personaId);
			EmojiPicker.pinEmoji('unicode:fox', personaId);
			EmojiPicker.pinEmoji('unicode:heart', personaId);

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
