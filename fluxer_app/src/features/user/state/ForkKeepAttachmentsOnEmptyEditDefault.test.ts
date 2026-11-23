// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tyne-chat/tyne#904. "Keep attachments when clearing an edit" reads on where the device stored no choice,
// and a stored choice wins, also once the signed-in account's storage loads after the store was created.

import {beforeAll, describe, expect, it, vi} from 'vitest';

type StorageModule = typeof import('@app/features/platform/state/PersistentStorage');
type BackendModule = typeof import('@app/features/platform/state/PersistentStorageBackend');
type AdvancedSettingsStore = typeof import('@app/features/user/state/AdvancedSettings').default;

const KEY = 'AdvancedSettings:keepAttachmentsOnEmptyMessageEdit';
const ACCOUNT_WITH_IT_OFF = 'https://one.example/api::100';
const ACCOUNT_WITH_IT_ON = 'https://one.example/api::200';
const ACCOUNT_WITHOUT_IT = 'https://one.example/api::300';

let storage: StorageModule;
let backend: BackendModule;
let AdvancedSettings: AdvancedSettingsStore;

beforeAll(async () => {
	vi.resetModules();
	backend = await import('@app/features/platform/state/PersistentStorageBackend');
	storage = await import('@app/features/platform/state/PersistentStorage');
	const saved = backend.getPersistentStorageBackend();
	await saved.set(ACCOUNT_WITH_IT_OFF, KEY, 'false');
	await saved.set(ACCOUNT_WITH_IT_ON, KEY, 'true');
	// The app starts its storage signed out, and only then loads the stores.
	await storage.initializeAppStorage();
	await storage.activateAppStorageScope(null);
	AdvancedSettings = (await import('@app/features/user/state/AdvancedSettings')).default;
});

describe('keep attachments when clearing an edit', () => {
	it('is on before any choice is stored', () => {
		expect(AdvancedSettings.keepAttachmentsOnEmptyMessageEdit).toBe(true);
	});

	it('takes a stored off once the account storage loads', async () => {
		await storage.activateAppStorageScope(ACCOUNT_WITH_IT_OFF);
		expect(AdvancedSettings.keepAttachmentsOnEmptyMessageEdit).toBe(false);
	});

	it('takes a stored on', async () => {
		await storage.activateAppStorageScope(ACCOUNT_WITH_IT_ON);
		expect(AdvancedSettings.keepAttachmentsOnEmptyMessageEdit).toBe(true);
	});

	it('goes back to on for an account that stored no choice', async () => {
		await storage.activateAppStorageScope(ACCOUNT_WITH_IT_OFF);
		expect(AdvancedSettings.keepAttachmentsOnEmptyMessageEdit).toBe(false);
		await storage.activateAppStorageScope(ACCOUNT_WITHOUT_IT);
		expect(AdvancedSettings.keepAttachmentsOnEmptyMessageEdit).toBe(true);
	});

	it('stores a choice made on the device', () => {
		AdvancedSettings.setKeepAttachmentsOnEmptyMessageEdit(false);
		expect(AdvancedSettings.keepAttachmentsOnEmptyMessageEdit).toBe(false);
		AdvancedSettings.setKeepAttachmentsOnEmptyMessageEdit(true);
		expect(AdvancedSettings.keepAttachmentsOnEmptyMessageEdit).toBe(true);
	});
});
