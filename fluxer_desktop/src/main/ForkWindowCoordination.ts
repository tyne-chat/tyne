// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: decisions the main process makes because several app windows can be open at once, kept
// apart from Electron so they can be unit tested. Every app window has its own connection to the
// server, so each one hears about the same new message and the same sign-in or sign-out.

const CLAIMED_NOTIFICATIONS_MAX = 500;
const RELOADS_PER_WINDOW_MAX = 3;
const RELOAD_WINDOW_MS = 30_000;

interface ForkWindowAccountState {
	// undefined until the window's current document has reported.
	account: string | null | undefined;
	// The value of the change counter when this window was last known to be up to date.
	changes: number;
}

export interface ForkNotificationClaimRequest {
	// The window asking.
	readonly windowId: number;
	// What is being announced, for example a message id.
	readonly key: string;
	// The channel the message is in, when it is a message.
	readonly channelId: string | null;
	// The window the operating system currently has focused, if it is one of ours.
	readonly focusedWindowId: number | null;
}

// Lets exactly one window announce (notify and play a sound for) each event.
export class ForkNotificationClaims {
	private readonly claimed = new Set<string>();
	private readonly viewedChannels = new Map<number, string>();

	// A window reports the channel it is showing while it has focus, or null when it has none.
	setViewedChannel(windowId: number, channelId: string | null): void {
		if (channelId == null) {
			this.viewedChannels.delete(windowId);
		} else {
			this.viewedChannels.set(windowId, channelId);
		}
	}

	releaseWindow(windowId: number): void {
		this.viewedChannels.delete(windowId);
	}

	claim(request: ForkNotificationClaimRequest): boolean {
		const {windowId, key, channelId, focusedWindowId} = request;
		// The user is looking at this channel in another window, which plays its own in-channel
		// sound. A second announcement from a background window would be a duplicate.
		if (
			channelId != null &&
			focusedWindowId != null &&
			focusedWindowId !== windowId &&
			this.viewedChannels.get(focusedWindowId) === channelId
		) {
			return false;
		}
		if (this.claimed.has(key)) {
			return false;
		}
		this.claimed.add(key);
		if (this.claimed.size > CLAIMED_NOTIFICATIONS_MAX) {
			const oldest = this.claimed.values().next().value;
			if (oldest !== undefined) {
				this.claimed.delete(oldest);
			}
		}
		return true;
	}
}

// Keeps every app window on the same signed-in account. The account store is shared by all
// windows, but each window only reads it when it loads, so after one window signs in, signs out
// or switches account the others are still showing the old account until they are reloaded.
//
// A window reports the account it has settled on: null while it is signed out, which is also how
// every window starts before it restores a saved account.
export class ForkWindowAccountSync {
	// The account the app is on, or undefined before any window has restored one.
	private current: string | null | undefined = undefined;
	// Counts changes of the current account, to tell which windows started loading before one.
	private changes = 0;
	private readonly windows = new Map<number, ForkWindowAccountState>();
	private readonly reloads = new Map<number, Array<number>>();
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	// Returns the windows to reload.
	report(windowId: number, account: string | null): Array<number> {
		const state = this.windows.get(windowId) ?? {account: undefined, changes: this.changes};
		const previous = state.account;
		state.account = account;
		this.windows.set(windowId, state);
		if (previous === account) {
			return [];
		}
		if (account == null) {
			// From "just loaded" to signed out says nothing. From an account to signed out is a sign-out.
			return previous == null ? [] : this.adopt(windowId, null);
		}
		if (this.current === account) {
			state.changes = this.changes;
			return [];
		}
		// The window restored an account other than the one the app is on, and the app changed
		// account after this window started loading: it read the account store too early.
		if (previous == null && this.current !== undefined && state.changes !== this.changes) {
			return this.reload([windowId]);
		}
		return this.adopt(windowId, account);
	}

	// The window is loading a fresh document, so what its last document said no longer holds.
	forget(windowId: number): void {
		this.windows.set(windowId, {account: undefined, changes: this.changes});
	}

	releaseWindow(windowId: number): void {
		this.windows.delete(windowId);
		this.reloads.delete(windowId);
	}

	// The user signed in, signed out or switched account in this window.
	private adopt(windowId: number, account: string | null): Array<number> {
		this.current = account;
		this.changes += 1;
		const stale: Array<number> = [];
		for (const [otherId, other] of this.windows) {
			if (otherId === windowId || other.account === account) {
				other.changes = this.changes;
			} else if (other.account !== undefined) {
				stale.push(otherId);
			}
			// A window that has not reported yet is still loading. It either reads the new
			// account, or reports the old one and is caught as having read too early.
		}
		return this.reload(stale);
	}

	private reload(windowIds: ReadonlyArray<number>): Array<number> {
		const reloading = windowIds.filter((windowId) => this.allowReload(windowId));
		for (const windowId of reloading) {
			this.forget(windowId);
		}
		return reloading;
	}

	// Windows that somehow never agree must not reload each other forever.
	private allowReload(windowId: number): boolean {
		const now = this.now();
		const recent = (this.reloads.get(windowId) ?? []).filter((at) => now - at < RELOAD_WINDOW_MS);
		if (recent.length >= RELOADS_PER_WINDOW_MAX) {
			this.reloads.set(windowId, recent);
			return false;
		}
		recent.push(now);
		this.reloads.set(windowId, recent);
		return true;
	}
}

// Loads app windows one after another. A window activates the instance it talks to while it
// loads, and upstream's activation is a transaction that fails if another window activates in
// the middle of it, so two windows must never be loading at the same time.
export class ForkWindowLoadQueue {
	private readonly waiting: Array<{readonly windowId: number; readonly start: () => void}> = [];
	private loading: number | null = null;

	// Runs start now if nothing is loading, otherwise once the windows ahead of it have settled.
	enqueue(windowId: number, start: () => void): void {
		this.waiting.push({windowId, start});
		this.advance();
	}

	// A window that is loading outside the queue (the main window, or a reload).
	markLoading(windowId: number): void {
		if (this.loading == null) {
			this.loading = windowId;
		}
	}

	// The window finished loading, gave up, or closed.
	settle(windowId: number): void {
		const index = this.waiting.findIndex((entry) => entry.windowId === windowId);
		if (index !== -1) {
			this.waiting.splice(index, 1);
		}
		if (this.loading === windowId) {
			this.loading = null;
			this.advance();
		}
	}

	isLoading(windowId: number): boolean {
		return this.loading === windowId;
	}

	private advance(): void {
		while (this.loading == null) {
			const next = this.waiting.shift();
			if (next === undefined) {
				return;
			}
			this.loading = next.windowId;
			try {
				next.start();
			} catch {
				this.loading = null;
			}
		}
	}
}

export interface ForkWindowPlacement {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

// Where each app window was the last time it sat still outside fullscreen. A window that leaves
// HTML fullscreen (a video, say) is put back there. Upstream keeps one such position, the main
// window's, which is right while there is one window and sends every other window to the main
// window's place.
export class ForkWindowRestingBounds {
	private readonly settled = new Map<number, ForkWindowPlacement>();
	private readonly pending = new Map<number, ReturnType<typeof setTimeout>>();

	record(windowId: number, bounds: ForkWindowPlacement): void {
		this.settled.set(windowId, {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height});
	}

	// The window moved or changed size. Going fullscreen is reported as a move like any other, so
	// the new place only counts once the window has stayed put for delayMs, and read returns null
	// if the window turns out to be fullscreen by then.
	noteChange(windowId: number, read: () => ForkWindowPlacement | null, delayMs: number): void {
		const waiting = this.pending.get(windowId);
		if (waiting !== undefined) clearTimeout(waiting);
		this.pending.set(
			windowId,
			setTimeout(() => {
				this.pending.delete(windowId);
				const bounds = read();
				if (bounds != null) this.record(windowId, bounds);
			}, delayMs),
		);
	}

	get(windowId: number): ForkWindowPlacement | null {
		return this.settled.get(windowId) ?? null;
	}

	releaseWindow(windowId: number): void {
		const waiting = this.pending.get(windowId);
		if (waiting !== undefined) clearTimeout(waiting);
		this.pending.delete(windowId);
		this.settled.delete(windowId);
	}
}
