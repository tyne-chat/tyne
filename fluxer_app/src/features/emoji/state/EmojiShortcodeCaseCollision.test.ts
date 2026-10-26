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

import type {Channel} from '@app/features/channel/models/Channel';
import Emoji from './Emoji';

// tyne-chat/tyne#170 (audit EM-4): the picker numbers `~N` among emojis of exactly the same name, so
// typing a name it shows must give back that emoji when names differ only in case.
describe('custom emoji shortcodes whose names differ only in case', () => {
	const guildId = '1546374477426720768';
	const channel = {id: '1550364222498537472', guildId} as unknown as Channel;

	beforeEach(() => {
		Emoji.hydrateFromSnapshot([
			{
				guildId,
				emojis: [
					{id: '1550000000000000001', name: 'cat', animated: false},
					{id: '1550000000000000002', name: 'Cat', animated: false},
					{id: '1550000000000000003', name: 'Cat', animated: true},
					{id: '1550000000000000004', name: 'CAT', animated: false},
				] as never,
			},
		]);
	});

	it('resolves every name the picker shows to the emoji it shows', () => {
		const custom = Emoji.getAllEmojis(channel).filter((emoji) => emoji.id && emoji.guildId === guildId);
		expect(custom.map((emoji) => emoji.name).sort()).toEqual(['CAT', 'Cat', 'Cat~1', 'cat~1']);
		for (const emoji of custom) {
			expect(Emoji.findCustomEmojiForShortcode(channel, emoji.name)?.id, emoji.name).toBe(emoji.id);
		}
	});

	it('gives nothing for a number past the emojis of that name', () => {
		expect(Emoji.findCustomEmojiForShortcode(channel, 'Cat~2')).toBeUndefined();
		expect(Emoji.findCustomEmojiForShortcode(channel, 'cat~2')).toBeUndefined();
	});
});
