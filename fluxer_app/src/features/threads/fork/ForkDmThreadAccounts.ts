// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: an account's DM threads across a warm account switch on the desktop (tyne-chat/tyne#699). A switch resets
// every store and rebuilds the account from upstream's snapshot, which knows nothing of DM threads; switching to an
// account whose session stayed warm resumes it without a READY (completePromotedResume), so neither the account's
// DM threads nor whether it may start one came back until the next reconnect (Gemini Carbon's review). Each
// account's DM threads, as the gateway last gave them while it was in front, are kept here and put back on such a
// switch. Threads made while the account was in the background still arrive with its next READY.

import type {ChannelWire} from '@app/features/channel/models/Channel';

interface AccountDmThreads {
	canStart: boolean;
	threads: Map<string, ChannelWire>;
}

const accounts = new Map<string, AccountDmThreads>();
let current: string | null = null;

/** The account READY just gave DM threads for: its list starts again from READY's. */
export function rememberDmThreadAccount(accountKey: string, canStart: boolean): void {
	current = accountKey;
	accounts.set(accountKey, {canStart, threads: new Map()});
}

export function rememberDmThread(wire: ChannelWire): void {
	if (current === null) return;
	const account = accounts.get(current);
	const previous = account?.threads.get(wire.id);
	// An update may come without the member; keep the one known.
	account?.threads.set(wire.id, previous?.member && !wire.member ? {...wire, member: previous.member} : wire);
}

export function forgetDmThread(threadId: string): void {
	if (current !== null) accounts.get(current)?.threads.delete(threadId);
}

/** What to put back for `accountKey` on a warm switch to it, or null if nothing is known. */
export function dmThreadsToRestore(accountKey: string): {canStart: boolean; threads: Array<ChannelWire>} | null {
	current = accountKey;
	const account = accounts.get(accountKey);
	return account ? {canStart: account.canStart, threads: [...account.threads.values()]} : null;
}

export function clearDmThreadAccountsForTesting(): void {
	accounts.clear();
	current = null;
}
