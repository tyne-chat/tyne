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

// A re-import skips a planned message that is exactly what an earlier import wrote (ImportPlan.ts): the review tool
// records it with its keys sorted, and a plan made again lists the same message in its own order.
describe('an unchanged planned message', () => {
	const planned = () => ({
		discord_id: '1300000000000000001',
		message_id: '1235168840912990210',
		type: 0,
		author_id: '6001',
		persona_id: null,
		content: 'hello <:wave:1235168840912990209>',
		mention_user_ids: [],
		mention_role_ids: [],
		attachments: [{attachment_id: '9', path: 'lounge_Files/a.png', filename: 'a.png', size: 10}],
		embeds: [],
		reactions: [{emoji: {id: '1235168840912990209', name: 'wave'}, users: [{user_id: '6002', persona_id: null}]}],
		reference: null,
		command: null,
	});
	// As the review tool stores it (json.dumps with sort_keys), read back.
	const sortKeys = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sortKeys);
		if (!v || typeof v !== 'object') return v;
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
		return out;
	};
	const recorded = JSON.parse(JSON.stringify(sortKeys(planned())));

	it('is the same as its record, whatever the order of its keys', () => {
		expect(Object.keys(recorded)).not.toEqual(Object.keys(planned()));
		expect(same(recorded, planned())).toBe(true);
	});

	it('is not the same once anything in it changed', () => {
		expect(same(recorded, {...planned(), content: 'hello :wave:'})).toBe(false);
		expect(same(recorded, {...planned(), persona_id: '7001'})).toBe(false);
		expect(
			same(recorded, {...planned(), attachments: [{...planned().attachments[0], path: 'lounge_Files/b.png'}]}),
		).toBe(false);
		const reacted = planned();
		reacted.reactions[0].users.push({user_id: '6001', persona_id: null});
		expect(same(recorded, reacted)).toBe(false);
	});
});
