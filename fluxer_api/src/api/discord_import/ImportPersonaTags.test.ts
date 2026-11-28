// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaTagHolders} from '@app/api/discord_import/ImportPersonaTags';
import {describe, expect, it} from 'vitest';

const holders = (personas: Array<{id: string; tags: Array<{prefix?: string; suffix?: string}>; deleted?: boolean}>) => {
	let loads = 0;
	const h = new PersonaTagHolders(async () => {
		loads++;
		return personas.map((p) => ({...p, deleted: p.deleted ?? false}));
	});
	return {h, loads: () => loads};
};

describe('PersonaTagHolders', () => {
	it("drops a tag another live persona holds and keeps the persona's others", async () => {
		const {h} = holders([{id: 'aris', tags: [{prefix: 'Ar:'}]}]);
		expect(await h.free('u', 'aria', [{prefix: 'Ar:'}, {prefix: 'Aa:'}])).toEqual({
			kept: [{prefix: 'Aa:'}],
			dropped: [{prefix: 'Ar:'}],
		});
	});

	it('lets a persona keep its own tags, and compares tags as the API does (trimmed, case-sensitive)', async () => {
		const {h} = holders([
			{id: 'aria', tags: [{prefix: 'Ar:'}]},
			{id: 'butler', tags: [{prefix: 'But:'}]},
		]);
		expect((await h.free('u', 'aria', [{prefix: 'Ar:'}])).dropped).toEqual([]);
		expect(await h.free('u', 'other', [{prefix: 'but:'}, {prefix: ' But: '}])).toEqual({
			kept: [{prefix: 'but:'}],
			dropped: [{prefix: ' But: '}],
		});
	});

	it('ignores deleted personas and empty tags', async () => {
		const {h} = holders([{id: 'old', tags: [{prefix: 'Ar:'}], deleted: true}]);
		expect(await h.free('u', 'aria', [{prefix: 'Ar:'}, {}])).toEqual({kept: [{prefix: 'Ar:'}, {}], dropped: []});
	});

	it('counts what this run writes: a second persona with the same tag gives it up', async () => {
		const {h, loads} = holders([]);
		const first = await h.free('u', 'wren', [{prefix: 'W1'}]);
		await h.record('u', 'wren', first.kept, false);
		expect((await h.free('u', 'wren-birdhouse', [{prefix: 'W1'}])).dropped).toEqual([{prefix: 'W1'}]);
		await h.record('u', 'wren', [], true);
		expect((await h.free('u', 'wren-birdhouse', [{prefix: 'W1'}])).dropped).toEqual([]);
		expect(loads()).toBe(1);
	});

	it("keeps each owner's tags apart", async () => {
		const owners: Record<string, Array<{id: string; tags: Array<{prefix: string}>; deleted: boolean}>> = {
			u: [{id: 'aris', tags: [{prefix: 'Ar:'}], deleted: false}],
			v: [],
		};
		const h = new PersonaTagHolders(async (userId) => owners[userId] ?? []);
		expect((await h.free('v', 'aria', [{prefix: 'Ar:'}])).dropped).toEqual([]);
		expect((await h.free('u', 'aria', [{prefix: 'Ar:'}])).dropped).toEqual([{prefix: 'Ar:'}]);
	});
});
