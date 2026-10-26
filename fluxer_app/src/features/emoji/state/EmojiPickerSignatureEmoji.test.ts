// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {runInAction} from 'mobx';
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

import type {Channel} from '@app/features/channel/models/Channel';
import {addTestPersona} from '@app/features/persona/state/__fixtures__/PersonaTestFixtures';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import Emoji from './Emoji';
import EmojiPicker, {getEmojiUsageKey} from './EmojiPicker';
import EmojiPins from './EmojiPins';

// tyne-chat/tyne#84: a custom signature emoji that has also been used showed up twice.
describe('EmojiPicker: custom signature emojis', () => {
	const guildId = '1530000000000000001';
	const emojiId = '1539483995778367498';
	const channel = {id: '1530000000000000002', guildId} as unknown as Channel;

	beforeEach(() => {
		EmojiPins.reset();
		Emoji.hydrateFromSnapshot([{guildId, emojis: [{id: emojiId, name: 'BlushHide', animated: false} as never]}]);
		runInAction(() => PersonaStore.setPersonas([]));
	});

	const addPersonaWithSignature = () =>
		runInAction(() =>
			addTestPersona(PersonaStore, {
				name: 'Fox',
				signature_emojis: [{id: emojiId, name: 'BlushHide', animated: false}],
			}),
		);

	const usageKey = () => {
		const emoji = Emoji.getEmojiById(emojiId);
		if (!emoji) throw new Error('test emoji missing from the registry');
		return getEmojiUsageKey(emoji);
	};

	const countWithId = (keys: ReadonlyArray<string>) => keys.filter((key) => key.endsWith(`:${emojiId}`)).length;

	it('lists a used custom signature emoji once', () => {
		const persona = addPersonaWithSignature();
		EmojiPicker.trackEmojiUsage(usageKey(), persona.id);
		EmojiPicker.trackEmojiUsage(usageKey());

		expect(countWithId(EmojiPicker.getFrecentEmojiKeys(0, undefined, persona.id))).toBe(1);
	});

	it('lists a pinned custom signature emoji once, at its pin', () => {
		const persona = addPersonaWithSignature();
		EmojiPins.pinEmoji(usageKey());

		const keys = EmojiPicker.getFrecentEmojiKeys(0, undefined, persona.id);
		expect(countWithId(keys)).toBe(1);
		expect(keys[0]).toBe(usageKey());
	});

	it('shows a used custom signature emoji once in the quick reaction bar', () => {
		const persona = addPersonaWithSignature();
		EmojiPicker.trackEmojiUsage(usageKey(), persona.id);
		EmojiPicker.trackEmojiUsage(usageKey());

		const quick = Emoji.getQuickReactionEmojis(channel, 4, persona.id);
		expect(quick.filter((emoji) => emoji.id === emojiId)).toHaveLength(1);
	});
});
