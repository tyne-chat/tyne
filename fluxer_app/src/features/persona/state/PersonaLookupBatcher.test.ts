// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaLookupItem} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PersonaLookupBatcher, type PersonaLookupPair} from './PersonaLookupBatcher';

const item = (userId: string, personaId: string, name = 'Fox'): PersonaLookupItem => ({
	id: personaId,
	user_id: userId,
	name,
});

describe('PersonaLookupBatcher', () => {
	let send: ReturnType<typeof vi.fn<(pairs: Array<PersonaLookupPair>) => Promise<Array<PersonaLookupItem>>>>;
	let batcher: PersonaLookupBatcher;

	beforeEach(() => {
		vi.useFakeTimers();
		send = vi.fn(async (pairs: Array<PersonaLookupPair>) => pairs.map((p) => item(p.userId, p.personaId)));
		batcher = new PersonaLookupBatcher(send, {delayMs: 50, failureCooldownMs: 60_000, notFoundCooldownMs: 600_000});
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('sends lookups made close together as one request, the same persona once', async () => {
		const answers = Promise.all([
			batcher.lookup({userId: 'u1', personaId: 'p1'}),
			batcher.lookup({userId: 'u1', personaId: 'p1'}),
			batcher.lookup({userId: 'u2', personaId: 'p2'}),
		]);
		await vi.advanceTimersByTimeAsync(60);

		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toEqual([
			{userId: 'u1', personaId: 'p1'},
			{userId: 'u2', personaId: 'p2'},
		]);
		expect((await answers).map((a) => a?.id)).toEqual(['p1', 'p1', 'p2']);
	});

	it('shares an answer still on its way', async () => {
		let release: (items: Array<PersonaLookupItem>) => void = () => {};
		send.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		const first = batcher.lookup({userId: 'u1', personaId: 'p1'});
		await vi.advanceTimersByTimeAsync(60);
		const second = batcher.lookup({userId: 'u1', personaId: 'p1'});
		await vi.advanceTimersByTimeAsync(60);
		release([item('u1', 'p1')]);

		expect((await first)?.id).toBe('p1');
		expect((await second)?.id).toBe('p1');
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('does not ask again for a persona it was told does not exist, unless forced', async () => {
		send.mockResolvedValue([]);
		expect(await lookupNow({userId: 'u1', personaId: 'gone'})).toBeNull();
		expect(await lookupNow({userId: 'u1', personaId: 'gone'})).toBeNull();
		expect(send).toHaveBeenCalledTimes(1);

		await lookupNow({userId: 'u1', personaId: 'gone'}, true);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('does not ask again inside the cooldown after a failure, even when forced, and asks after it', async () => {
		send.mockRejectedValueOnce(new Error('429'));
		expect(await lookupNow({userId: 'u1', personaId: 'p1'})).toBeNull();
		expect(await lookupNow({userId: 'u1', personaId: 'p1'}, true)).toBeNull();
		expect(send).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		expect((await lookupNow({userId: 'u1', personaId: 'p1'}))?.id).toBe('p1');
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('splits more than 100 personas over several requests', async () => {
		const lookups = Array.from({length: 150}, (_, i) => batcher.lookup({userId: 'u1', personaId: `p${i}`}));
		await vi.advanceTimersByTimeAsync(60);
		await Promise.all(lookups);

		expect(send.mock.calls.map(([pairs]) => pairs.length)).toEqual([100, 50]);
	});

	it('drops what is pending or on its way when reset', async () => {
		let release: (items: Array<PersonaLookupItem>) => void = () => {};
		send.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		const flying = batcher.lookup({userId: 'u1', personaId: 'p1'});
		await vi.advanceTimersByTimeAsync(60);
		const pending = batcher.lookup({userId: 'u1', personaId: 'p2'});
		batcher.reset();
		release([item('u1', 'p1')]);

		expect(await flying).toBeNull();
		expect(await pending).toBeNull();
	});

	async function lookupNow(pair: PersonaLookupPair, force = false): Promise<PersonaLookupItem | null> {
		const answer = batcher.lookup(pair, {force});
		await vi.advanceTimersByTimeAsync(60);
		return answer;
	}
});
