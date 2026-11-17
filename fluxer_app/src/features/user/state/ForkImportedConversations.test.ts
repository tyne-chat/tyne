// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: requests behind the Open DM of a Discord import placeholder's profile (tyne-chat/tyne#696).

import {beforeEach, describe, expect, it, vi} from 'vitest';
import {IMPORTED_CONVERSATION_FAILURE_COOLDOWN_MS, ImportedConversationsStore} from './ForkImportedConversations';

/** Lets the store's promise chain run to the end; no timers involved. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('ImportedConversationsStore', () => {
	let now: number;
	let viewer: string | null;
	let fetchChannelId: ReturnType<typeof vi.fn<(userId: string) => Promise<string | null>>>;
	let store: ImportedConversationsStore;

	beforeEach(() => {
		now = 1_000_000;
		viewer = 'me';
		fetchChannelId = vi.fn(async (userId: string) => (userId === 'with-history' ? 'dm1' : null));
		store = new ImportedConversationsStore({fetchChannelId, now: () => now, viewerId: () => viewer});
	});

	it('sends one request however many profiles ask, and none once answered', async () => {
		for (let i = 0; i < 20; i++) store.ensure('with-history');
		expect(store.channelId('with-history')).toBeNull();
		await settle();
		for (let i = 0; i < 20; i++) store.ensure('with-history');
		now += 24 * 60 * 60_000;
		store.ensure('with-history');
		expect(fetchChannelId).toHaveBeenCalledTimes(1);
		expect(store.channelId('with-history')).toBe('dm1');
	});

	it('keeps an answer of none, and does not ask again', async () => {
		store.ensure('empty');
		await settle();
		store.ensure('empty');
		expect(fetchChannelId).toHaveBeenCalledTimes(1);
		expect(store.channelId('empty')).toBeNull();
	});

	it('leaves a failure alone for a minute, then asks once more', async () => {
		fetchChannelId.mockRejectedValueOnce(new Error('status 429'));
		store.ensure('with-history');
		await settle();
		for (let i = 0; i < 20; i++) store.ensure('with-history');
		now += IMPORTED_CONVERSATION_FAILURE_COOLDOWN_MS - 1;
		store.ensure('with-history');
		expect(fetchChannelId).toHaveBeenCalledTimes(1);
		expect(store.channelId('with-history')).toBeNull();
		now += 1;
		store.ensure('with-history');
		await settle();
		expect(fetchChannelId).toHaveBeenCalledTimes(2);
		expect(store.channelId('with-history')).toBe('dm1');
	});

	it('asks again for another account on the same device', async () => {
		store.ensure('with-history');
		await settle();
		viewer = 'other-account';
		expect(store.channelId('with-history')).toBeNull();
		store.ensure('with-history');
		expect(fetchChannelId).toHaveBeenCalledTimes(2);
	});
	// Gemini Carbon's review.
	it('asks nothing and answers nothing while signed out', async () => {
		viewer = null;
		store.ensure('with-history');
		await settle();
		expect(fetchChannelId).not.toHaveBeenCalled();
		expect(store.channelId('with-history')).toBeNull();
	});
});
