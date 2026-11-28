// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelWire} from '@app/features/channel/models/Channel';
import {HttpError} from '@app/features/platform/types/EndpointError';
import {DmThreadLinkLoader, RETRY_AFTER_MS} from '@app/features/threads/fork/ForkDmThreadLinkLoader';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {describe, expect, it} from 'vitest';

const dmThread = (id: string): ChannelWire =>
	({id, type: ChannelTypes.PUBLIC_THREAD, parent_id: '10', name: 'Prayer'}) as ChannelWire;
const httpError = (status: number) => new HttpError({method: 'GET', path: '/channels/1', status, body: {}});

function loader(answer: (id: string) => Promise<ChannelWire | undefined>) {
	const known = new Set<string>();
	const kept: Array<string> = [];
	let now = 0;
	let requests = 0;
	const links = new DmThreadLinkLoader({
		known: (id) => known.has(id),
		fetch: async (id) => {
			requests++;
			return answer(id);
		},
		isDmThread: (wire) => wire.guild_id == null && wire.type === ChannelTypes.PUBLIC_THREAD && wire.parent_id != null,
		keep: (wire) => {
			kept.push(wire.id);
			known.add(wire.id);
		},
		now: () => now,
		warn: () => {},
	});
	return {links, kept, requests: () => requests, wait: (ms: number) => (now += ms)};
}

describe('DmThreadLinkLoader', () => {
	it('keeps a DM thread the app did not know, asking once however many links and renders ask', async () => {
		const t = loader(async (id) => dmThread(id));
		await Promise.all([t.links.load('5'), t.links.load('5'), t.links.load('5')]);
		await t.links.load('5');
		expect(t.kept).toEqual(['5']);
		expect(t.requests()).toBe(1);
	});

	it('does not ask for a channel the app knows', async () => {
		const t = loader(async (id) => dmThread(id));
		await t.links.load('5');
		await t.links.load('5');
		expect(t.requests()).toBe(1);
	});

	it('never asks again for a channel that is no DM thread, or that it may not see', async () => {
		const plain = loader(async (id) => ({id, type: ChannelTypes.DM}) as ChannelWire);
		await plain.links.load('6');
		await plain.links.load('6');
		expect([plain.kept, plain.requests()]).toEqual([[], 1]);
		const guildThread = loader(async (id) => ({...dmThread(id), guild_id: '9'}) as ChannelWire);
		await guildThread.links.load('7');
		expect(guildThread.kept).toEqual([]);
		for (const status of [403, 404]) {
			const denied = loader(async () => {
				throw httpError(status);
			});
			await denied.links.load('8');
			denied.wait(10 * RETRY_AFTER_MS);
			await denied.links.load('8');
			expect([denied.kept, denied.requests()]).toEqual([[], 1]);
		}
	});

	it('asks again after a failure that may pass, no sooner than RETRY_AFTER_MS', async () => {
		let fail = true;
		const t = loader(async (id) => {
			if (fail) throw httpError(503);
			return dmThread(id);
		});
		await t.links.load('5');
		await t.links.load('5');
		expect(t.requests()).toBe(1);
		t.wait(RETRY_AFTER_MS);
		fail = false;
		await t.links.load('5');
		expect([t.kept, t.requests()]).toEqual([['5'], 2]);
	});

	it('forgets everything on reset (another account)', async () => {
		const t = loader(async () => {
			throw httpError(403);
		});
		await t.links.load('8');
		t.links.reset();
		await t.links.load('8');
		expect(t.requests()).toBe(2);
	});
});
