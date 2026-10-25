// SPDX-License-Identifier: AGPL-3.0-or-later

import {randomInt} from 'node:crypto';
import {createPersonaID, type PersonaID} from '@app/api/BrandedTypes';
import {FLUXER_EPOCH, TIMESTAMP_SHIFT} from '@fluxer/snowflake/src/Snowflake';

/**
 * Persona IDs are snowflakes whose 22 low bits, the worker and sequence of an ordinary snowflake,
 * are random, so that one persona's ID gives nothing away about the IDs of personas made at the same
 * time. Each ID takes a millisecond of its own, later than the last one this process gave out, so
 * IDs still sort in the order the personas were made (the export relies on that).
 */

const RANDOM_LIMIT = Number(1n << TIMESTAMP_SHIFT);
// A clock that went back by more than this is not waited for: the ID takes the next millisecond.
const MAX_WAIT_MS = 50;

export interface PersonaIdGeneratorDeps {
	now: () => number;
	wait: (ms: number) => Promise<void>;
	random: (limit: number) => number;
}

export function createPersonaIdGenerator(deps: PersonaIdGeneratorDeps): () => Promise<PersonaID> {
	let lastMs = -1;
	return async () => {
		let nowMs = deps.now();
		while (nowMs <= lastMs && lastMs - nowMs < MAX_WAIT_MS) {
			await deps.wait(lastMs - nowMs + 1);
			nowMs = deps.now();
		}
		// Read after the last wait, so that calls waiting together still get one millisecond each.
		const ms = Math.max(nowMs, lastMs + 1);
		lastMs = ms;
		const timestamp = BigInt(ms) - FLUXER_EPOCH;
		return createPersonaID((timestamp << TIMESTAMP_SHIFT) | BigInt(deps.random(RANDOM_LIMIT)));
	};
}

export const generatePersonaId = createPersonaIdGenerator({
	now: Date.now,
	wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	random: (limit) => randomInt(limit),
});
