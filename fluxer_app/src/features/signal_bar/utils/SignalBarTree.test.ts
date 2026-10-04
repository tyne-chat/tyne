// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	buildSignalBarTree,
	categoryState,
	rootState,
	setCategory,
	setChannel,
	setRoot,
} from '@app/features/signal_bar/utils/SignalBarTree';
import {
	EMPTY_GUILD_SIGNAL_BAR_SETTINGS,
	resolveSignalBarEnabled,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {describe, expect, it} from 'vitest';

const tree = buildSignalBarTree([
	{id: 'cat2', name: 'Second', type: 4, position: 2, parentId: null},
	{id: 'cat1', name: 'First', type: 4, position: 1, parentId: null},
	{id: 'a', name: 'a', type: 0, position: 1, parentId: 'cat1'},
	{id: 'b', name: 'b', type: 5, position: 2, parentId: 'cat1'},
	{id: 'c', name: 'c', type: 0, position: 1, parentId: 'cat2'},
	{id: 'voice', name: 'voice', type: 2, position: 0, parentId: 'cat1'},
	{id: 'loose', name: 'loose', type: 0, position: 0, parentId: null},
]);

describe('signal bar channel tree', () => {
	it('orders categories and keeps only text and announcement channels', () => {
		expect(tree.channels.map((channel) => channel.id)).toEqual(['loose']);
		expect(tree.categories.map((category) => [category.id, category.channels.map((channel) => channel.id)])).toEqual([
			['cat1', ['a', 'b']],
			['cat2', ['c']],
		]);
	});

	it('shows a mixed parent when only some children are on', () => {
		const settings = setChannel(EMPTY_GUILD_SIGNAL_BAR_SETTINGS, tree, 'a', true);
		expect(settings).toEqual({default: false, categories: {}, channels: {a: true}});
		expect(categoryState(settings, tree.categories[0]!)).toBe('mixed');
		expect(categoryState(settings, tree.categories[1]!)).toBe('off');
		expect(rootState(settings, tree)).toBe('mixed');
	});

	it('turns a fully ticked category into a default that new channels inherit', () => {
		let settings = setChannel(EMPTY_GUILD_SIGNAL_BAR_SETTINGS, tree, 'a', true);
		settings = setChannel(settings, tree, 'b', true);
		expect(settings).toEqual({default: false, categories: {cat1: true}, channels: {}});
		expect(resolveSignalBarEnabled(settings, 'new-channel', 'cat1')).toBe(true);
		expect(resolveSignalBarEnabled(settings, 'new-channel', 'cat2')).toBe(false);
	});

	it('ticking a category clears exceptions under it', () => {
		let settings = setCategory(EMPTY_GUILD_SIGNAL_BAR_SETTINGS, tree, 'cat1', true);
		settings = setChannel(settings, tree, 'a', false);
		expect(settings).toEqual({default: false, categories: {cat1: true}, channels: {a: false}});
		expect(categoryState(settings, tree.categories[0]!)).toBe('mixed');
		settings = setCategory(settings, tree, 'cat1', true);
		expect(settings).toEqual({default: false, categories: {cat1: true}, channels: {}});
	});

	it('folds to the community default once everything agrees', () => {
		let settings = setCategory(EMPTY_GUILD_SIGNAL_BAR_SETTINGS, tree, 'cat1', true);
		settings = setCategory(settings, tree, 'cat2', true);
		expect(rootState(settings, tree)).toBe('mixed');
		settings = setChannel(settings, tree, 'loose', true);
		expect(settings).toEqual({default: true, categories: {}, channels: {}});
		expect(rootState(settings, tree)).toBe('on');
		expect(setRoot(settings, false)).toEqual(EMPTY_GUILD_SIGNAL_BAR_SETTINGS);
	});

	it('keeps an exception when one channel is switched off under a ticked community', () => {
		const settings = setChannel(setRoot(EMPTY_GUILD_SIGNAL_BAR_SETTINGS, true), tree, 'c', false);
		expect(settings).toEqual({default: true, categories: {cat2: false}, channels: {}});
		expect(rootState(settings, tree)).toBe('mixed');
		expect(resolveSignalBarEnabled(settings, 'a', 'cat1')).toBe(true);
	});
});
