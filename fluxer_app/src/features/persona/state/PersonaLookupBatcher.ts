// SPDX-License-Identifier: AGPL-3.0-or-later

import {MAX_PERSONA_LOOKUP_IDS, type PersonaLookupItem} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

export interface PersonaLookupPair {
	userId: string;
	personaId: string;
}

export interface PersonaLookupBatcherOptions {
	/** How long to collect lookups before sending them as one request. */
	delayMs?: number;
	/** After a failed request, how long its personas are not asked for again. */
	failureCooldownMs?: number;
	/** After an answer without the persona, how long it is not asked for again unless forced. */
	notFoundCooldownMs?: number;
	now?: () => number;
}

interface PendingLookup {
	pair: PersonaLookupPair;
	resolvers: Array<(item: PersonaLookupItem | null) => void>;
}

const lookupKey = (pair: PersonaLookupPair): string => `${pair.userId}:${pair.personaId}`;

/**
 * Fork: collects persona lookups made close together into one request to `POST /personas/lookup`.
 * Lookups of the same persona share one answer, and a persona whose lookup failed is not asked for
 * again until a cooldown has passed, so code that looks personas up while rendering cannot flood the
 * server (the global rate limit ends the session).
 */
export class PersonaLookupBatcher {
	private readonly pending = new Map<string, PendingLookup>();
	private readonly inFlight = new Map<string, Promise<PersonaLookupItem | null>>();
	private readonly failedUntil = new Map<string, number>();
	private readonly notFoundUntil = new Map<string, number>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private generation = 0;
	private readonly delayMs: number;
	private readonly failureCooldownMs: number;
	private readonly notFoundCooldownMs: number;
	private readonly now: () => number;

	constructor(
		private readonly send: (pairs: Array<PersonaLookupPair>) => Promise<Array<PersonaLookupItem>>,
		options: PersonaLookupBatcherOptions = {},
	) {
		this.delayMs = options.delayMs ?? 50;
		this.failureCooldownMs = options.failureCooldownMs ?? 60_000;
		this.notFoundCooldownMs = options.notFoundCooldownMs ?? 10 * 60_000;
		this.now = options.now ?? Date.now;
	}

	/**
	 * Looks up one persona; resolves to null when it is not found or the request fails. `force` asks
	 * again for a persona answered as not found, but never inside the cooldown after a failure.
	 */
	lookup(pair: PersonaLookupPair, options: {force?: boolean} = {}): Promise<PersonaLookupItem | null> {
		const key = lookupKey(pair);
		const now = this.now();
		if ((this.failedUntil.get(key) ?? 0) > now) return Promise.resolve(null);
		if (!options.force && (this.notFoundUntil.get(key) ?? 0) > now) return Promise.resolve(null);
		const flying = this.inFlight.get(key);
		if (flying) return flying;
		return new Promise((resolve) => {
			const existing = this.pending.get(key);
			if (existing) {
				existing.resolvers.push(resolve);
				return;
			}
			this.pending.set(key, {pair, resolvers: [resolve]});
			this.timer ??= setTimeout(() => this.flush(), this.delayMs);
		});
	}

	/** Forgets everything, as when the account changes; answers still on their way are dropped. */
	reset(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		for (const {resolvers} of this.pending.values()) for (const resolve of resolvers) resolve(null);
		this.pending.clear();
		this.inFlight.clear();
		this.failedUntil.clear();
		this.notFoundUntil.clear();
		this.generation++;
	}

	private flush(): void {
		this.timer = null;
		const batch = Array.from(this.pending.entries());
		this.pending.clear();
		for (let i = 0; i < batch.length; i += MAX_PERSONA_LOOKUP_IDS) {
			this.sendChunk(batch.slice(i, i + MAX_PERSONA_LOOKUP_IDS));
		}
	}

	private sendChunk(chunk: Array<[string, PendingLookup]>): void {
		const generation = this.generation;
		const request = this.send(chunk.map(([, {pair}]) => pair)).then(
			(items) => {
				const found = new Map(items.map((item) => [lookupKey({userId: item.user_id, personaId: item.id}), item]));
				return {found, failed: false};
			},
			() => ({found: new Map<string, PersonaLookupItem>(), failed: true}),
		);
		for (const [key] of chunk) {
			this.inFlight.set(
				key,
				request.then(({found}) => found.get(key) ?? null),
			);
		}
		void request.then(({found, failed}) => {
			const now = this.now();
			for (const [key, {resolvers}] of chunk) {
				const item = found.get(key) ?? null;
				if (generation === this.generation) {
					this.inFlight.delete(key);
					if (failed) this.failedUntil.set(key, now + this.failureCooldownMs);
					else if (!item) this.notFoundUntil.set(key, now + this.notFoundCooldownMs);
					else this.notFoundUntil.delete(key);
				}
				for (const resolve of resolvers) resolve(generation === this.generation ? item : null);
			}
		});
	}
}
