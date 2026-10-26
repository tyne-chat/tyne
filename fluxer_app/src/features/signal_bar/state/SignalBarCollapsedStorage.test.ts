// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the signal bar's caret is kept in app storage, per account on this device (tyne-chat/tyne#140).
// Production builds take raw `localStorage` away from the page, so it has to go through app storage.

import {beforeAll, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

type StorageModule = typeof import('@app/features/platform/state/PersistentStorage');
type SignalBarStoreType = typeof import('@app/features/signal_bar/state/SignalBarStore').default;

const ACCOUNT_A = 'https://one.example/api::100';
const ACCOUNT_B = 'https://one.example/api::200';

let storage: StorageModule;
let SignalBarStore: SignalBarStoreType;

beforeAll(async () => {
	vi.resetModules();
	storage = await import('@app/features/platform/state/PersistentStorage');
	await storage.initializeAppStorage();
	await storage.activateAppStorageScope(ACCOUNT_A);
	SignalBarStore = (await import('@app/features/signal_bar/state/SignalBarStore')).default;
	const {awaitHydration} = await import('@app/features/platform/utils/MobXPersistence');
	await awaitHydration('SignalBar');
});

describe('the signal bar caret', () => {
	it('starts expanded', () => {
		expect(SignalBarStore.collapsed).toBe(false);
	});

	it('is kept for the account that collapsed it, and only for that account', async () => {
		SignalBarStore.setCollapsed(true);
		await storage.activateAppStorageScope(ACCOUNT_B);
		expect(SignalBarStore.collapsed).toBe(false);

		await storage.activateAppStorageScope(ACCOUNT_A);
		expect(SignalBarStore.collapsed).toBe(true);
	});

	it('is not written to raw localStorage', () => {
		expect(Object.keys(localStorage).filter((key) => key.toLowerCase().includes('signalbar'))).toEqual([]);
	});
});
