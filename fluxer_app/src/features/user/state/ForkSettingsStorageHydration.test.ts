// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the settings this fork adds outside the persisted MobX stores are stored per account. The
// stores that hold them are created before the signed-in account's storage is loaded, so they have
// to pick the stored values up when it is. A restart is exactly that sequence.

import {beforeAll, describe, expect, it, vi} from 'vitest';

type StorageModule = typeof import('@app/features/platform/state/PersistentStorage');
type BackendModule = typeof import('@app/features/platform/state/PersistentStorageBackend');
type LayoutStateStore = typeof import('@app/features/ui/state/LayoutState').default;

const ACCOUNT_WITH_SETTINGS = 'https://one.example/api::100';
const ACCOUNT_WITHOUT_SETTINGS = 'https://one.example/api::200';
const LEFT_SIDEBAR_VISIBLE_KEY = 'fluxer:ui:left-sidebar-visible';
const EDGE_HOVER_PEEK_ENABLED_KEY = 'fluxer:ui:edge-hover-peek-enabled';

let storage: StorageModule;
let backend: BackendModule;
let LayoutState: LayoutStateStore;

beforeAll(async () => {
	vi.resetModules();
	backend = await import('@app/features/platform/state/PersistentStorageBackend');
	storage = await import('@app/features/platform/state/PersistentStorage');
	const saved = backend.getPersistentStorageBackend();
	await saved.set(ACCOUNT_WITH_SETTINGS, LEFT_SIDEBAR_VISIBLE_KEY, 'false');
	await saved.set(ACCOUNT_WITH_SETTINGS, EDGE_HOVER_PEEK_ENABLED_KEY, 'false');
	// The app starts its storage signed out, and only then loads the stores.
	await storage.initializeAppStorage({scoped: true});
	await storage.activateAppStorageScope(null);
	LayoutState = (await import('@app/features/ui/state/LayoutState')).default;
});

describe('fork settings kept in app storage', () => {
	it('start from their defaults before the account storage is loaded', () => {
		expect(LayoutState.leftSidebarVisible).toBe(true);
		expect(LayoutState.edgeHoverPeekEnabled).toBe(true);
	});

	it('take the stored values once the account storage is loaded', async () => {
		await storage.activateAppStorageScope(ACCOUNT_WITH_SETTINGS);
		expect(LayoutState.leftSidebarVisible).toBe(false);
		expect(LayoutState.edgeHoverPeekEnabled).toBe(false);
	});

	it('go back to their defaults for an account that has stored none', async () => {
		await storage.activateAppStorageScope(ACCOUNT_WITHOUT_SETTINGS);
		expect(LayoutState.leftSidebarVisible).toBe(true);
		expect(LayoutState.edgeHoverPeekEnabled).toBe(true);
	});

	it('keep a change across the next load of the account storage', async () => {
		await storage.activateAppStorageScope(ACCOUNT_WITHOUT_SETTINGS);
		LayoutState.setLeftSidebarVisible(false);
		LayoutState.setEdgeHoverPeekEnabled(false);
		await storage.activateAppStorageScope(ACCOUNT_WITH_SETTINGS);
		await storage.activateAppStorageScope(ACCOUNT_WITHOUT_SETTINGS);
		expect(LayoutState.leftSidebarVisible).toBe(false);
		expect(LayoutState.edgeHoverPeekEnabled).toBe(false);
	});
});
