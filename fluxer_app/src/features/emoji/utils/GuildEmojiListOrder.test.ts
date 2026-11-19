// SPDX-License-Identifier: AGPL-3.0-or-later

import {orderGuildEmojiSections} from '@app/features/emoji/utils/GuildEmojiListOrder';
import {describe, expect, it} from 'vitest';

// Snowflakes grow with time, so a larger id is a newer upload.
const emojis = [
	{id: '1500000000000000002', name: 'banana', animated: false},
	{id: '1500000000000000004', name: 'Apple', animated: true},
	{id: '1500000000000000001', name: 'cherry', animated: true},
	{id: '1500000000000000003', name: 'date', animated: false},
];
const names = (list: ReadonlyArray<{name: string}>) => list.map((emoji) => emoji.name);

describe('orderGuildEmojiSections', () => {
	it('lists by name in two sections by default', () => {
		const {staticEmojis, animatedEmojis} = orderGuildEmojiSections(emojis, 'name', 'split');
		expect(names(staticEmojis)).toEqual(['banana', 'date']);
		expect(names(animatedEmojis)).toEqual(['Apple', 'cherry']);
	});

	it('lists the newest upload first with Recently added', () => {
		const {staticEmojis, animatedEmojis} = orderGuildEmojiSections(emojis, 'recent', 'split');
		expect(names(staticEmojis)).toEqual(['date', 'banana']);
		expect(names(animatedEmojis)).toEqual(['Apple', 'cherry']);
	});

	it('puts every emoji in the first section with All in one list', () => {
		expect(orderGuildEmojiSections(emojis, 'recent', 'together')).toEqual({
			staticEmojis: [emojis[1], emojis[3], emojis[0], emojis[2]],
			animatedEmojis: [],
		});
		expect(names(orderGuildEmojiSections(emojis, 'name', 'together').staticEmojis)).toEqual([
			'Apple',
			'banana',
			'cherry',
			'date',
		]);
	});

	it('compares ids as numbers, so a 19-digit id is newer than an 18-digit one', () => {
		const mixed = [
			{id: '1000000000000000000', name: 'newer', animated: false},
			{id: '999999999999999999', name: 'older', animated: false},
		];
		expect(names(orderGuildEmojiSections(mixed, 'recent', 'together').staticEmojis)).toEqual(['newer', 'older']);
		expect(names(orderGuildEmojiSections(mixed.slice().reverse(), 'recent', 'together').staticEmojis)).toEqual([
			'newer',
			'older',
		]);
	});

	it('lists same-named emojis newest first with Name (A–Z)', () => {
		const same = [
			{id: '999999999999999999', name: 'star', animated: false},
			{id: '1000000000000000000', name: 'Star', animated: false},
		];
		expect(orderGuildEmojiSections(same, 'name', 'together').staticEmojis.map((emoji) => emoji.id)).toEqual([
			'1000000000000000000',
			'999999999999999999',
		]);
	});

	it('leaves the list it was given as it was', () => {
		const given = emojis.slice();
		orderGuildEmojiSections(given, 'recent', 'together');
		expect(given).toEqual(emojis);
	});
});
