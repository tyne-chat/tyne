// SPDX-License-Identifier: AGPL-3.0-or-later

import {canonical, changedSince, mergeFields, mergeSets, same} from '@app/api/discord_import/ImportMerge';
import {describe, expect, it} from 'vitest';

describe('canonical', () => {
	it('compares stored values with planned ones', () => {
		expect(same(123n, '123')).toBe(true);
		expect(same(new Date('2025-07-01T10:00:00.000Z'), '2025-07-01T10:00:00.000Z')).toBe(true);
		expect(same(new Set([2n, 1n]), ['1', '2'])).toBe(true);
		expect(same({b: 1, a: null}, {b: 1})).toBe(true);
		expect(same(null, [])).toBe(true);
		expect(same(undefined, null)).toBe(true);
	});

	it('tells different values apart', () => {
		expect(same('hello', 'hello!')).toBe(false);
		expect(same(['1', '2'], ['2', '1'])).toBe(false);
		expect(canonical({a: [1]})).not.toBe(canonical({a: [2]}));
	});
});

describe('mergeFields', () => {
	const fields = ['content', 'pinned'] as const;

	it("takes the plan's value where nobody changed the import's", () => {
		const merge = mergeFields(
			{content: 'old', pinned: null},
			{content: 'old', pinned: null},
			{content: 'new', pinned: null},
			fields,
		);
		expect(merge).toEqual({patch: {content: 'new'}, kept: []});
	});

	it('keeps a value someone changed on Tyne', () => {
		const merge = mergeFields(
			{content: 'old', pinned: null},
			{content: 'edited', pinned: 'now'},
			{content: 'new', pinned: null},
			fields,
		);
		expect(merge).toEqual({patch: {}, kept: ['content', 'pinned']});
	});

	it("does nothing where Tyne already has the plan's value", () => {
		const merge = mergeFields(
			{content: 'old', pinned: null},
			{content: 'new', pinned: null},
			{content: 'new', pinned: null},
			fields,
		);
		expect(merge).toEqual({patch: {}, kept: []});
	});

	it('leaves a change made on Tyne alone when the plan does not change that field', () => {
		const merge = mergeFields(
			{content: 'old', pinned: null},
			{content: 'edited', pinned: null},
			{content: 'old', pinned: null},
			fields,
		);
		expect(merge).toEqual({patch: {}, kept: ['content']});
	});
});

describe('changedSince', () => {
	it('notices a change made on Tyne', () => {
		expect(changedSince({content: 'a'}, {content: 'b'}, ['content'])).toBe(true);
		expect(changedSince({content: 'a'}, {content: 'a'}, ['content'])).toBe(false);
	});
});

describe('mergeSets', () => {
	it("adds the plan's new members and removes the ones it dropped", () => {
		expect(mergeSets(new Set(['a', 'b']), new Set(['a', 'b']), new Set(['b', 'c']))).toEqual({
			add: ['c'],
			remove: ['a'],
		});
	});

	it('keeps what someone added on Tyne and does not bring back what they removed', () => {
		expect(mergeSets(new Set(['a', 'b']), new Set(['b', 'mine']), new Set(['a', 'b']))).toEqual({add: [], remove: []});
	});

	it('does not add twice what is already there', () => {
		expect(mergeSets(new Set(), new Set(['c']), new Set(['c']))).toEqual({add: [], remove: []});
	});
});
