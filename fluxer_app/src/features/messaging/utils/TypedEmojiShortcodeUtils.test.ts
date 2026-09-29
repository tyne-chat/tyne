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
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import type {Channel} from '@app/features/channel/models/Channel';
import Emoji from '@app/features/emoji/state/Emoji';
import {
	resolveTypedEmojiShortcodes,
	resolveTypedEmojiToken,
} from '@app/features/messaging/utils/TypedEmojiShortcodeUtils';
import type {I18n} from '@lingui/core';

const mockI18n = {
	_: (descriptor: {message?: string}) => descriptor.message ?? '',
	locale: 'en',
} as unknown as I18n;

const testGuildId = '1546374477426720768';
const testChannel = {
	id: '1550364222498537472',
	guildId: testGuildId,
} as unknown as Channel;

describe('TypedEmojiShortcodeUtils - Casing and Disambiguation Resolution', () => {
	beforeEach(() => {
		// Set up guild emojis replicating prod & dev scenarios:
		// 1. "Sleeping" (animated, uppercase S) - collides with lowercase unicode "sleeping" (😴)
		// 2. "Zzz" (animated, uppercase Z) - collides with lowercase unicode "zzz" (💤)
		// 3. "Lamb" (animated, newer snowflake) & "lamb" (static, older snowflake)
		// 4. Duplicate "Sleeping" with older snowflake to test ~1 disambiguation
		Emoji.handleGuildEmojiUpdated({
			guildId: testGuildId,
			emojis: [
				{
					id: '1554001957872467968',
					name: 'Sleeping',
					animated: true,
				},
				{
					id: '1550000000000000000',
					name: 'Sleeping',
					animated: false,
				},
				{
					id: 'custom-zzz-1',
					name: 'Zzz',
					animated: true,
				},
				{
					id: 'custom-lamb-animated',
					name: 'Lamb',
					animated: true,
				},
				{
					id: 'custom-lamb-static',
					name: 'lamb',
					animated: false,
				},
			],
		});
	});

	it('resolves exact capitalized custom emoji (:Sleeping:) without collision deadlock', () => {
		const result = resolveTypedEmojiToken('Sleeping', testChannel, testGuildId, mockI18n);
		expect(result).not.toBeNull();
		expect(result).toEqual({
			kind: 'custom',
			emojiId: '1554001957872467968',
			animated: true,
			display: ':Sleeping:',
			wire: '<a:Sleeping:1554001957872467968>',
		});
	});

	it('resolves exact lowercase unicode emoji (:sleeping:) to standard emoji', () => {
		const result = resolveTypedEmojiToken('sleeping', testChannel, testGuildId, mockI18n);
		expect(result).toMatchObject({
			kind: 'standard',
			name: 'sleeping',
			surrogate: '😴',
		});
	});

	it('resolves exact capitalized custom emoji (:Zzz:) without collision deadlock', () => {
		const result = resolveTypedEmojiToken('Zzz', testChannel, testGuildId, mockI18n);
		expect(result).not.toBeNull();
		expect(result).toEqual({
			kind: 'custom',
			emojiId: 'custom-zzz-1',
			animated: true,
			display: ':Zzz:',
			wire: '<a:Zzz:custom-zzz-1>',
		});
	});

	it('resolves exact lowercase unicode emoji (:zzz:) to standard emoji', () => {
		const result = resolveTypedEmojiToken('zzz', testChannel, testGuildId, mockI18n);
		expect(result).toMatchObject({
			kind: 'standard',
			name: 'zzz',
			surrogate: '💤',
		});
	});

	it('distinguishes between :lamb: (static) and :Lamb: (animated) based on exact case', () => {
		const staticLamb = resolveTypedEmojiToken('lamb', testChannel, testGuildId, mockI18n);
		expect(staticLamb).toEqual({
			kind: 'custom',
			emojiId: 'custom-lamb-static',
			animated: false,
			display: ':lamb:',
			wire: '<:lamb:custom-lamb-static>',
		});

		const animatedLamb = resolveTypedEmojiToken('Lamb', testChannel, testGuildId, mockI18n);
		expect(animatedLamb).toEqual({
			kind: 'custom',
			emojiId: 'custom-lamb-animated',
			animated: true,
			display: ':Lamb:',
			wire: '<a:Lamb:custom-lamb-animated>',
		});
	});

	it('falls back case-insensitively to custom emoji when all-caps (:LAMB:)', () => {
		const shoutingLamb = resolveTypedEmojiToken('LAMB', testChannel, testGuildId, mockI18n);
		expect(shoutingLamb).toMatchObject({
			kind: 'custom',
			emojiId: 'custom-lamb-animated',
		});
	});

	it('falls back case-insensitively to unicode when capitalized standard emoji (:Fire:)', () => {
		const result = resolveTypedEmojiToken('Fire', testChannel, testGuildId, mockI18n);
		expect(result).toMatchObject({
			kind: 'standard',
			name: 'fire',
			surrogate: '🔥',
		});
	});

	it('resolves disambiguated duplicate custom emoji (:Sleeping~1:) to the second custom emoji', () => {
		const secondSleeping = resolveTypedEmojiToken('Sleeping~1', testChannel, testGuildId, mockI18n);
		expect(secondSleeping).not.toBeNull();
		expect(secondSleeping).toEqual({
			kind: 'custom',
			emojiId: '1550000000000000000',
			animated: false,
			display: ':Sleeping~1:',
			wire: '<:Sleeping:1550000000000000000>',
		});
	});

	it('correctly transforms message content in resolveTypedEmojiShortcodes on wire send', () => {
		const content = 'Night :Sleeping: sleep tight :sleeping: and stay :Fire:!';
		const resolved = resolveTypedEmojiShortcodes({
			content,
			channel: testChannel,
			guildIdFallback: testGuildId,
			i18n: mockI18n,
		});

		// :Sleeping: -> custom wire markdown
		// :sleeping: -> left as :sleeping: for standard markdown renderer
		// :Fire: -> replaced with literal surrogate 🔥
		expect(resolved).toBe('Night <a:Sleeping:1554001957872467968> sleep tight :sleeping: and stay 🔥!');
	});
});
