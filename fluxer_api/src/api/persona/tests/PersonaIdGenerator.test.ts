// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createPersonaIdGenerator, type PersonaIdGeneratorDeps} from '@app/api/persona/PersonaIdGenerator';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {FLUXER_EPOCH, TIMESTAMP_SHIFT} from '@fluxer/snowflake/src/Snowflake';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const LOW_BITS = (1n << TIMESTAMP_SHIFT) - 1n;

function msOf(id: bigint | string): number {
	return Number((BigInt(id) >> TIMESTAMP_SHIFT) + FLUXER_EPOCH);
}

function lowBitsOf(id: bigint | string): bigint {
	return BigInt(id) & LOW_BITS;
}

/** A clock that moves only when the generator waits, and a random source that answers in turn. */
function fakeDeps(startMs: number, randoms: Array<number> = [0]): PersonaIdGeneratorDeps & {waits: Array<number>} {
	let clock = startMs;
	let next = 0;
	const waits: Array<number> = [];
	return {
		waits,
		now: () => clock,
		wait: async (ms) => {
			waits.push(ms);
			clock += ms;
		},
		random: (limit) => {
			expect(limit).toBe(Number(LOW_BITS + 1n));
			return randoms[next++ % randoms.length]!;
		},
	};
}

describe('Persona IDs', () => {
	it('carry the time of their making in the high bits', async () => {
		const generate = createPersonaIdGenerator(fakeDeps(1_760_000_000_000));
		expect(msOf(await generate())).toBe(1_760_000_000_000);
	});

	it('take all 22 low bits from the random source', async () => {
		const highest = Number(LOW_BITS);
		const generate = createPersonaIdGenerator(fakeDeps(1_760_000_000_000, [0x2abcde, highest]));
		expect(lowBitsOf(await generate())).toBe(0x2abcden);
		expect(lowBitsOf(await generate())).toBe(LOW_BITS);
	});

	it('give each ID a millisecond of its own, waiting for the next one', async () => {
		const deps = fakeDeps(1_760_000_000_000);
		const generate = createPersonaIdGenerator(deps);
		const ids = [await generate(), await generate(), await generate()];
		expect(ids.map(msOf)).toEqual([1_760_000_000_000, 1_760_000_000_001, 1_760_000_000_002]);
		expect(deps.waits).toEqual([1, 1]);
	});

	it('give calls made together a millisecond each', async () => {
		const generate = createPersonaIdGenerator(fakeDeps(1_760_000_000_000));
		const ms = (await Promise.all([generate(), generate(), generate()])).map(msOf);
		expect(new Set(ms).size).toBe(3);
		expect(Math.min(...ms)).toBe(1_760_000_000_000);
	});

	it('do not wait for a clock that went back, and still move forward', async () => {
		let clock = 1_760_000_005_000;
		const waits: Array<number> = [];
		const generate = createPersonaIdGenerator({
			now: () => clock,
			wait: async (ms) => {
				waits.push(ms);
			},
			random: () => 0,
		});
		const first = await generate();
		clock = 1_760_000_000_000;
		const second = await generate();
		expect(msOf(second)).toBe(msOf(first) + 1);
		expect(waits).toEqual([]);
	});

	describe('made by an import', () => {
		let harness: ApiTestHarness;

		beforeAll(async () => {
			harness = await createApiTestHarness();
		});
		beforeEach(async () => {
			await harness.reset();
		});
		afterAll(async () => {
			await harness.shutdown();
		});

		it('sort in the order of the import, a millisecond each, with random low bits', async () => {
			const owner = await createTestAccount(harness);
			const names = Array.from({length: 30}, (_, i) => `Member ${i + 1}`);
			const imported = await createBuilder<Array<{id: string; name: string}>>(harness, owner.token)
				.post('/users/@me/personas/import')
				.body(names.map((name) => ({name, visibility: 'private'})))
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(imported.map((persona) => persona.name)).toEqual(names);
			const ms = imported.map((persona) => msOf(persona.id));
			for (let i = 1; i < ms.length; i++) {
				expect(ms[i]).toBeGreaterThan(ms[i - 1]!);
			}
			// A counter would leave the low bits of every ID below 64; random bits do so with a chance of 2^-480.
			expect(imported.some((persona) => lowBitsOf(persona.id) >= 64n)).toBe(true);
		});
	});
});
