// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: what ForkDmThreadLinks.ts asks for a link to a DM thread the app has not loaded (tyne-chat/tyne#963), apart
// from the app's stores so that it can be tested alone. Requests: at most one per linked channel at a time, whatever
// the number of links or renders. Remembered for the session (no request again): "not a DM thread" and "no access"
// (403, 404). A failure that may pass (offline, 5xx, 429) is asked again no sooner than RETRY_AFTER_MS later, by the
// next link that needs it. A channel the app knows asks nothing.

import type {ChannelWire} from '@app/features/channel/models/Channel';
import {HttpError} from '@app/features/platform/types/EndpointError';

export const RETRY_AFTER_MS = 60_000;

export interface DmThreadLinkDeps {
	known(channelId: string): boolean;
	fetch(channelId: string): Promise<ChannelWire | undefined>;
	/** Whether a fetched channel is a thread in a DM (ForkDmThreads.isGuildlessThreadWire). */
	isDmThread(wire: ChannelWire): boolean;
	keep(wire: ChannelWire): void;
	now(): number;
	warn(message: string, error: unknown): void;
}

export class DmThreadLinkLoader {
	private readonly running = new Map<string, Promise<void>>();
	private readonly settled = new Set<string>();
	private readonly failedAt = new Map<string, number>();

	constructor(private readonly deps: DmThreadLinkDeps) {}

	load(channelId: string): Promise<void> {
		if (this.deps.known(channelId) || this.settled.has(channelId)) return Promise.resolve();
		const failed = this.failedAt.get(channelId);
		if (failed !== undefined && this.deps.now() - failed < RETRY_AFTER_MS) return Promise.resolve();
		const running = this.running.get(channelId);
		if (running) return running;
		const lookup = this.lookup(channelId).finally(() => this.running.delete(channelId));
		this.running.set(channelId, lookup);
		return lookup;
	}

	reset(): void {
		this.running.clear();
		this.settled.clear();
		this.failedAt.clear();
	}

	private async lookup(channelId: string): Promise<void> {
		try {
			const wire = await this.deps.fetch(channelId);
			this.failedAt.delete(channelId);
			if (wire && this.deps.isDmThread(wire)) this.deps.keep(wire);
			else this.settled.add(channelId);
		} catch (error) {
			if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
				this.settled.add(channelId);
				return;
			}
			this.failedAt.set(channelId, this.deps.now());
			this.deps.warn(`Failed to load the linked channel ${channelId}`, error);
		}
	}
}
