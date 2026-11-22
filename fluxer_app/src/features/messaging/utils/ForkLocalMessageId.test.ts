// SPDX-License-Identifier: AGPL-3.0-or-later

// tyne-chat/tyne#701: local message ids (send nonces, local notices) keep the clock's time but can
// never equal a worker-0 server id from the same millisecond.

import {MAX_SEQUENCE, MAX_WORKER_ID} from '@fluxer/snowflake/src/Snowflake';
import {extractTimestamp, fromTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {describe, expect, it} from 'vitest';
import {newLocalMessageId} from './ForkLocalMessageId';

const NOW = Date.parse('2026-11-16T23:07:27.843Z');
const workerOf = (id: string) => (BigInt(id) >> 12n) & MAX_WORKER_ID;
const sequenceOf = (id: string) => BigInt(id) & MAX_SEQUENCE;

describe('newLocalMessageId', () => {
	it("keeps the clock's millisecond, so local messages sort where they did", () => {
		expect(extractTimestamp(newLocalMessageId(NOW))).toBe(NOW);
	});

	it('never has worker 0, at either end of the random range', () => {
		const lowest = newLocalMessageId(NOW, () => 0);
		const highest = newLocalMessageId(NOW, () => 0.999_999_9);
		expect(workerOf(lowest)).toBe(1n);
		expect(sequenceOf(lowest)).toBe(0n);
		expect(workerOf(highest)).toBe(MAX_WORKER_ID);
		expect(sequenceOf(highest)).toBe(MAX_SEQUENCE);
	});

	it("differs from the server's id for the same millisecond, and from the next call", () => {
		const serverId = fromTimestamp(NOW);
		const seen = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			const id = newLocalMessageId(NOW);
			expect(id).not.toBe(serverId);
			expect(workerOf(id)).not.toBe(0n);
			seen.add(id);
		}
		expect(seen.size).toBeGreaterThan(990);
	});
});
