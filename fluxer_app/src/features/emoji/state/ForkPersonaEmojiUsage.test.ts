// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: verifies persona emoji usage persists via AppStorage (not raw window.localStorage)
// and isolates cleanly per account storage scope (tyne-chat/tyne#140, tyne-chat/tyne#947).

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import EmojiPicker from '@app/features/emoji/state/EmojiPicker';
import AppStorage, {
	activateAppStorageScope,
	initializeAppStorage,
} from '@app/features/platform/state/PersistentStorage';

const PERSONA_USAGE_KEY = 'fluxer_persona_emoji_usage';

describe('EmojiPicker persona usage storage', () => {
	beforeEach(async () => {
		await initializeAppStorage();
		await activateAppStorageScope(null);
		AppStorage.removeItem(PERSONA_USAGE_KEY);
		window.localStorage.removeItem(PERSONA_USAGE_KEY);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await activateAppStorageScope(null);
		AppStorage.removeItem(PERSONA_USAGE_KEY);
		window.localStorage.removeItem(PERSONA_USAGE_KEY);
	});

	it('stores persona emoji usage in AppStorage without touching raw window.localStorage', async () => {
		const origSetItem = window.localStorage.setItem.bind(window.localStorage);
		const rawWriteCalls: Array<string> = [];

		vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
			throw new Error('Raw localStorage is unavailable in production');
		});
		vi.spyOn(window.localStorage, 'setItem').mockImplementation((key: string, value: string) => {
			if (key === PERSONA_USAGE_KEY) {
				rawWriteCalls.push(`setItem:${key}`);
				throw new Error('Raw localStorage is unavailable in production');
			}
			return origSetItem(key, value);
		});

		EmojiPicker.trackEmojiUsage('unicode:tada', 'persona_a');

		expect(rawWriteCalls).toEqual([]);
		const persisted = AppStorage.getJSON<Record<string, Record<string, unknown>>>(PERSONA_USAGE_KEY);
		expect(persisted?.persona_a?.['unicode:tada']).toBeDefined();

		await activateAppStorageScope('account_b');
		expect(EmojiPicker.getPersonaUsage('persona_a')).toBeUndefined();

		await activateAppStorageScope(null);
		expect(EmojiPicker.getPersonaUsage('persona_a')?.['unicode:tada']).toBeDefined();
	});
});
