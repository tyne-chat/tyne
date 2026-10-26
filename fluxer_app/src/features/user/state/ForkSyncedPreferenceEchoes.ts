// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tells a late echo of this window's own saves from a newer change made elsewhere
// (tyne-chat/tyne#236).
//
// For 60 s after a save, upstream's UserSettings marks the saved fields "recently acknowledged", and
// the engine then keeps this window's value of such a field whenever an incoming one differs. That
// drops stale echoes, but it also drops every newer change another window or device makes in that
// minute; nothing applies it later, and this window's next save overwrites it. Upstream's mobile app
// does what this file does instead (`_pendingEchoes` and `_isStaleSnapshot` in its
// synced_preferences_store.dart): it keeps the blobs of its recent saves, the one each save replaced
// and the one the server acknowledged, and treats a blob from the server as stale only while it can
// still be older than those saves.
//
// The server sends its blobs in the order it stores them, so once the echo of a save arrives,
// nothing older than that save can follow, and the save is forgotten: a later blob equal to the one
// it replaced is someone changing it back (a pin, then an unpin), not a late echo.

/** A blob from the server, compared as the server encodes it. */
type Blob = string;

/** As long as upstream's `RECENT_SYNCED_PREFERENCES_ACK_WINDOW_MS`, after which nothing is held back. */
const ECHO_WINDOW_MS = 60_000;
const MAX_SAVES = 8;

interface Save {
	/** The server's blob this save replaced. */
	readonly base: Blob;
	/** The server's blob after this save. */
	readonly acknowledged: Blob;
	readonly at: number;
}

type Verdict = 'stale' | 'newer' | 'unchecked';

export class SyncedPreferenceEchoes {
	private saves: Array<Save> = [];
	private lastFromServer: Blob | null = null;
	private verdict: Verdict = 'unchecked';

	constructor(private readonly now: () => number = Date.now) {}

	/**
	 * A save the server acknowledged: `base` is the blob it replaced, `acknowledged` the result. A
	 * save whose echo has already come (it can come before the response) is not kept.
	 */
	recordSave(base: Blob | null, acknowledged: Blob): void {
		this.prune();
		const replaced = base ?? '';
		if (replaced === acknowledged || this.lastFromServer === acknowledged) return;
		this.saves.push({base: replaced, acknowledged, at: this.now()});
		if (this.saves.length > MAX_SAVES) this.saves.shift();
	}

	/**
	 * A blob from the server (READY, `USER_SETTINGS_UPDATE`, the refetch after a conflict), just
	 * before it is merged. It is stale if a save of this window has replaced it and the echo of that
	 * save has not come yet, or if it is the echo of a save older than the latest. The echo of a
	 * save ends it and the saves before it; any other blob is newer and ends them all.
	 */
	noteFromServer(raw: Blob | null): void {
		this.prune();
		const blob = raw ?? '';
		this.lastFromServer = blob;
		const echoOf = this.saves.findIndex((save) => save.acknowledged === blob);
		if (echoOf >= 0) {
			const latest = echoOf === this.saves.length - 1;
			this.saves = this.saves.slice(echoOf + 1);
			this.verdict = latest ? 'newer' : 'stale';
			return;
		}
		if (this.saves.some((save) => save.base === blob)) {
			this.verdict = 'stale';
			return;
		}
		this.saves = [];
		this.verdict = 'newer';
	}

	/**
	 * Upstream's recently acknowledged fields for the merge about to run: dropped when that merge is of
	 * a blob from the server that is not stale, so the blob applies to them too. Merges of anything
	 * else (another tab's copy, this window's own save) keep upstream's rule.
	 */
	ackedFieldsToKeep<F>(recentlyAckedFields: ReadonlyArray<F>): ReadonlyArray<F> {
		const verdict = this.verdict;
		this.verdict = 'unchecked';
		return verdict === 'newer' ? [] : recentlyAckedFields;
	}

	clear(): void {
		this.saves = [];
		this.lastFromServer = null;
		this.verdict = 'unchecked';
	}

	private prune(): void {
		const cutoff = this.now() - ECHO_WINDOW_MS;
		this.saves = this.saves.filter((save) => save.at > cutoff);
	}
}

export const forkSyncedPreferenceEchoes = new SyncedPreferenceEchoes();
