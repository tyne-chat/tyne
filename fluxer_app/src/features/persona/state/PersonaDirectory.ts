// SPDX-License-Identifier: AGPL-3.0-or-later

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import Authentication from '@app/features/auth/state/Authentication';
import {http} from '@app/features/platform/transport/RestTransport';
import {HttpError} from '@app/features/platform/types/EndpointError';
import {Logger} from '@app/features/platform/utils/AppLogger';
import type {PublicPersonaListResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {action, makeObservable, observable} from 'mobx';

const logger = new Logger('PersonaDirectory');

/** How long an answer is used before the next profile opened asks again. */
export const PERSONA_DIRECTORY_TTL_MS = 60_000;
/** How long a failed request is left alone, so that renders and reopened profiles don't repeat it. */
export const PERSONA_DIRECTORY_FAILURE_COOLDOWN_MS = 60_000;
/** How long to collect the copies of a persona change (one per shared community) before asking again. */
export const PERSONA_DIRECTORY_CHANGE_SETTLE_MS = 1_000;

export type PersonaDirectoryStatus = 'loading' | 'ready' | 'failed' | 'forbidden';

export interface PersonaDirectoryEntry {
	status: PersonaDirectoryStatus;
	list: PublicPersonaListResponse | null;
}

type FetchResult = {status: 'ready'; list: PublicPersonaListResponse} | {status: 'forbidden'} | {status: 'failed'};

export interface PersonaDirectoryDeps {
	fetchList: (userId: string) => Promise<FetchResult>;
	now: () => number;
	viewerId: () => string | null;
	schedule: (run: () => void, ms: number) => void;
}

async function fetchListOverHttp(userId: string): Promise<FetchResult> {
	try {
		const res = await http.get<PublicPersonaListResponse>(ForkEndpoints.USER_PUBLIC_PERSONAS(userId));
		if (res.ok && res.body && Array.isArray(res.body.personas)) return {status: 'ready', list: res.body};
		if (res.status === 403) return {status: 'forbidden'};
	} catch (err) {
		if (err instanceof HttpError && err.status === 403) return {status: 'forbidden'};
		logger.warn(`Failed to fetch the public personas of user ${userId}`, err);
	}
	return {status: 'failed'};
}

/**
 * Other accounts' public personas and display tags, for the Personas tab, sheet and pill
 * (tyne-chat/tyne#189). One request per account answers all of them: requests in flight are shared,
 * an answer is used for a minute, and a failure is not asked again for a minute unless the person
 * presses Retry. A 403 (the viewer may not see the profile) is kept as `forbidden`, which hides the
 * pill. The viewer's own personas never come from here (see `usePersonaDirectory`).
 *
 * Entries are keyed by viewer as well, so a desktop account switch never shows one account what
 * another was allowed to see.
 */
export class PersonaDirectoryStore {
	private readonly entries = observable.map<string, PersonaDirectoryEntry>(undefined, {deep: false});
	private readonly expiresAt = new Map<string, number>();
	private readonly inFlight = new Map<string, Promise<void>>();
	/** Lists changed while their request was on its way: asked once more when it lands. */
	private readonly askAgain = new Set<string>();
	/** Bumped when an account changes its personas, so components showing it ask again. */
	private readonly revisions = observable.map<string, number>();
	/** Accounts whose change is being collected, with the number of the latest copy. */
	private readonly settling = new Map<string, number>();
	private readonly deps: PersonaDirectoryDeps;

	constructor(deps?: Partial<PersonaDirectoryDeps>) {
		this.deps = {
			fetchList: deps?.fetchList ?? fetchListOverHttp,
			now: deps?.now ?? Date.now,
			viewerId: deps?.viewerId ?? (() => Authentication.currentUserId ?? null),
			schedule: deps?.schedule ?? ((run, ms) => setTimeout(run, ms)),
		};
		makeObservable<this, 'settle' | 'announceChange'>(this, {settle: action, announceChange: action});
	}

	private key(userId: string): string {
		return `${this.deps.viewerId() ?? ''}:${userId}`;
	}

	get(userId: string): PersonaDirectoryEntry | undefined {
		return this.entries.get(this.key(userId));
	}

	/** Changes each time the account changes its personas; a component showing it asks again then. */
	revision(userId: string): number {
		return this.revisions.get(this.key(userId)) ?? 0;
	}

	/** Asks for the list unless there is a fresh answer, a request in flight, or a recent failure. */
	ensure(userId: string): void {
		const key = this.key(userId);
		if (this.inFlight.has(key)) return;
		const entry = this.entries.get(key);
		if (entry && this.deps.now() < (this.expiresAt.get(key) ?? 0)) return;
		this.load(key, userId, entry);
	}

	/** Asks again now, whatever is cached, unless a request is already in flight. */
	retry(userId: string): void {
		const key = this.key(userId);
		if (this.inFlight.has(key)) return;
		this.load(key, userId, this.entries.get(key));
	}

	/**
	 * Marks an account's list out of date, after it changed its personas: a profile opened from now
	 * on asks again. The change arrives once per shared community, so the components already showing
	 * the list are told a second after the last copy, and ask once; when a request is on its way then,
	 * its answer may predate the change, and it is asked once more when it lands. The last answer
	 * stays on screen meanwhile.
	 */
	forget(userId: string): void {
		const suffix = `:${userId}`;
		const keys = Array.from(this.entries.keys()).filter((key) => key.endsWith(suffix));
		for (const key of keys) this.expiresAt.set(key, 0);
		if (keys.length === 0) return;
		const copy = (this.settling.get(userId) ?? 0) + 1;
		this.settling.set(userId, copy);
		this.deps.schedule(() => {
			if (this.settling.get(userId) !== copy) return;
			this.settling.delete(userId);
			this.announceChange(keys);
		}, PERSONA_DIRECTORY_CHANGE_SETTLE_MS);
	}

	private announceChange(keys: Array<string>): void {
		for (const key of keys) {
			if (this.inFlight.has(key)) this.askAgain.add(key);
			this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
		}
	}

	private load(key: string, userId: string, previous: PersonaDirectoryEntry | undefined): void {
		// Keep showing the last answer while asking again; show loading only when there is none.
		if (!previous?.list) this.settle(key, {status: 'loading', list: null}, 0);
		const request = this.deps
			.fetchList(userId)
			.catch((): FetchResult => ({status: 'failed'}))
			.then((result) => {
				this.inFlight.delete(key);
				if (result.status === 'ready') {
					this.settle(key, {status: 'ready', list: result.list}, PERSONA_DIRECTORY_TTL_MS);
				} else if (result.status === 'forbidden') {
					this.settle(key, {status: 'forbidden', list: null}, PERSONA_DIRECTORY_TTL_MS);
				} else {
					this.settle(key, {status: 'failed', list: previous?.list ?? null}, PERSONA_DIRECTORY_FAILURE_COOLDOWN_MS);
				}
				if (this.askAgain.delete(key) && result.status !== 'failed') {
					this.load(key, userId, this.entries.get(key));
				}
			});
		this.inFlight.set(key, request);
	}

	private settle(key: string, entry: PersonaDirectoryEntry, ttlMs: number): void {
		this.entries.set(key, entry);
		this.expiresAt.set(key, this.deps.now() + ttlMs);
	}
}

export const PersonaDirectory = new PersonaDirectoryStore();
