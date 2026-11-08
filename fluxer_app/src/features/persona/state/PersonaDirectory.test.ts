// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {PublicPersonaListResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
	PERSONA_DIRECTORY_CHANGE_SETTLE_MS,
	PERSONA_DIRECTORY_FAILURE_COOLDOWN_MS,
	PERSONA_DIRECTORY_TTL_MS,
	type PersonaDirectoryDeps,
	PersonaDirectoryStore,
} from './PersonaDirectory';

type FetchResult = Awaited<ReturnType<PersonaDirectoryDeps['fetchList']>>;

const list = (names: Array<string>): PublicPersonaListResponse => ({
	display_tag_text: 'LANTERN',
	display_tag_icon: null,
	personas: names.map((name, i) => ({id: String(1000 + i), name, visibility: 'public'})),
});

/** Lets the store's promise chain run to the end; no timers involved. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('PersonaDirectoryStore', () => {
	let now: number;
	let viewer: string | null;
	let fetchList: ReturnType<typeof vi.fn<(userId: string) => Promise<FetchResult>>>;
	let store: PersonaDirectoryStore;
	let scheduled: Array<{run: () => void; at: number}>;
	/** Moves the store's clock on, running what it scheduled for then. */
	const advance = (ms: number) => {
		now += ms;
		for (const job of scheduled.filter((j) => j.at <= now)) {
			scheduled.splice(scheduled.indexOf(job), 1);
			job.run();
		}
	};

	beforeEach(() => {
		now = 1_000_000;
		viewer = 'me';
		fetchList = vi.fn(async (): Promise<FetchResult> => ({status: 'ready', list: list(['Wren', 'Marlowe'])}));
		scheduled = [];
		store = new PersonaDirectoryStore({
			fetchList,
			now: () => now,
			viewerId: () => viewer,
			schedule: (run, ms) => scheduled.push({run, at: now + ms}),
		});
	});

	it('sends one request however many places ask at once, and none while the answer is fresh', async () => {
		for (let i = 0; i < 20; i++) store.ensure('u1');
		expect(store.get('u1')?.status).toBe('loading');
		await settle();
		for (let i = 0; i < 20; i++) store.ensure('u1');

		expect(fetchList).toHaveBeenCalledTimes(1);
		expect(store.get('u1')?.status).toBe('ready');
		expect(store.get('u1')?.list?.personas.map((p) => p.name)).toEqual(['Wren', 'Marlowe']);
	});

	it('asks again after the answer has aged, keeping the old answer meanwhile', async () => {
		store.ensure('u1');
		await settle();
		now += PERSONA_DIRECTORY_TTL_MS + 1;
		store.ensure('u1');

		expect(store.get('u1')?.status).toBe('ready');
		expect(fetchList).toHaveBeenCalledTimes(2);
	});

	it('does not repeat a failed request on the next render, only after the cooldown or on Retry', async () => {
		fetchList.mockResolvedValueOnce({status: 'failed'});
		store.ensure('u1');
		await settle();
		expect(store.get('u1')?.status).toBe('failed');

		for (let i = 0; i < 20; i++) store.ensure('u1');
		expect(fetchList).toHaveBeenCalledTimes(1);

		store.retry('u1');
		await settle();
		expect(fetchList).toHaveBeenCalledTimes(2);
		expect(store.get('u1')?.status).toBe('ready');

		fetchList.mockResolvedValueOnce({status: 'failed'});
		store.retry('u1');
		await settle();
		now += PERSONA_DIRECTORY_FAILURE_COOLDOWN_MS + 1;
		store.ensure('u1');
		await settle();
		expect(fetchList).toHaveBeenCalledTimes(4);
	});

	it('treats a thrown request as a failure', async () => {
		fetchList.mockRejectedValueOnce(new Error('offline'));
		store.ensure('u1');
		await settle();
		store.ensure('u1');

		expect(store.get('u1')?.status).toBe('failed');
		expect(fetchList).toHaveBeenCalledTimes(1);
	});

	it('keeps a refusal and does not ask again while it is fresh', async () => {
		fetchList.mockResolvedValueOnce({status: 'forbidden'});
		store.ensure('u1');
		await settle();
		store.ensure('u1');

		expect(store.get('u1')).toEqual({status: 'forbidden', list: null});
		expect(fetchList).toHaveBeenCalledTimes(1);
	});

	it('shares a retry with the request already on its way', async () => {
		store.ensure('u1');
		store.retry('u1');
		store.retry('u1');
		await settle();

		expect(fetchList).toHaveBeenCalledTimes(1);
	});

	it('asks once after the account changed its personas, however many copies of the change arrive', async () => {
		store.ensure('u1');
		await settle();
		const revision = store.revision('u1');
		for (let i = 0; i < 5; i++) {
			store.forget('u1');
			advance(100);
			// A component showing the list asks whenever its revision changes.
			if (store.revision('u1') !== revision) store.ensure('u1');
		}
		expect(store.revision('u1')).toBe(revision);
		advance(PERSONA_DIRECTORY_CHANGE_SETTLE_MS);
		expect(store.revision('u1')).toBe(revision + 1);
		store.ensure('u1');
		store.ensure('u1');
		await settle();

		expect(fetchList).toHaveBeenCalledTimes(2);
		expect(store.get('u1')?.status).toBe('ready');
	});

	it('lets a profile opened during the change ask at once, and asks once more if that answer may predate it', async () => {
		store.ensure('u1');
		await settle();
		let release: (result: FetchResult) => void = () => {};
		fetchList.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		store.forget('u1');
		store.ensure('u1');
		expect(fetchList).toHaveBeenCalledTimes(2);
		expect(store.get('u1')?.list?.personas.map((p) => p.name)).toEqual(['Wren', 'Marlowe']);

		advance(PERSONA_DIRECTORY_CHANGE_SETTLE_MS);
		store.ensure('u1');
		expect(fetchList).toHaveBeenCalledTimes(2);
		release({status: 'ready', list: list(['Stale'])});
		await settle();
		await settle();

		expect(fetchList).toHaveBeenCalledTimes(3);
		expect(store.get('u1')?.list?.personas.map((p) => p.name)).toEqual(['Wren', 'Marlowe']);
	});

	it('asks nothing when the account changed and nobody is showing its list', async () => {
		store.ensure('u1');
		await settle();
		store.forget('u1');
		advance(PERSONA_DIRECTORY_CHANGE_SETTLE_MS);
		await settle();
		expect(fetchList).toHaveBeenCalledTimes(1);

		store.ensure('u1');
		expect(fetchList).toHaveBeenCalledTimes(2);
	});

	it('keeps what one signed-in account was told apart from another on the same device', async () => {
		store.ensure('u1');
		await settle();
		viewer = 'other';

		expect(store.get('u1')).toBeUndefined();
		store.ensure('u1');
		expect(fetchList).toHaveBeenCalledTimes(2);
	});
});
