// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {compareEmojisByName} from './EmojiSortingUtils';

describe('EmojiSortingUtils', () => {
	it('sorts emojis alphabetically case-insensitively', () => {
		const emojis = [
			{name: 'zebra', id: '1'},
			{name: 'Apple', id: '2'},
			{name: 'banana', id: '3'},
			{name: 'cat', id: '4'},
		];

		const sorted = [...emojis].sort(compareEmojisByName);

		expect(sorted.map((e) => e.name)).toEqual(['Apple', 'banana', 'cat', 'zebra']);
	});

	it('sorts numbers naturally rather than lexicographically', () => {
		const emojis = [
			{name: 'blob_10', id: '1'},
			{name: 'blob_2', id: '2'},
			{name: 'blob_1', id: '3'},
			{name: 'blob_20', id: '4'},
		];

		const sorted = [...emojis].sort(compareEmojisByName);

		expect(sorted.map((e) => e.name)).toEqual(['blob_1', 'blob_2', 'blob_10', 'blob_20']);
	});

	it('breaks ties deterministically with exact case and id', () => {
		const emojis = [
			{name: 'star', id: '200'},
			{name: 'star', id: '100'},
			{name: 'Star', id: '150'},
		];

		const sorted = [...emojis].sort(compareEmojisByName);

		expect(sorted).toEqual([
			{name: 'star', id: '100'},
			{name: 'star', id: '200'},
			{name: 'Star', id: '150'},
		]);
	});

	it('handles emojis without ids gracefully', () => {
		const emojis = [{name: 'smile'}, {name: 'angry'}, {name: 'blush'}];

		const sorted = [...emojis].sort(compareEmojisByName);

		expect(sorted.map((e) => e.name)).toEqual(['angry', 'blush', 'smile']);
	});
});
