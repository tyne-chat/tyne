// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: personas seen in the channel's messages only rank the suggestions; other accounts' come only
// from the server's mention route, which applies their mention setting, and the account's own come
// from its own store (tyne-chat/tyne#652).

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

const state = vi.hoisted(() => ({
	results: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
}));

vi.mock('@app/features/lexical/composer/useAutocompletePersonaSearch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/lexical/composer/useAutocompletePersonaSearch')>()),
	useAutocompletePersonaSearch: () => state.results,
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {
		// Newest first, as the cached messages are walked with `reverse`; stops when the callback says so.
		getCachedMessages: () => ({
			forEach: (callback: (message: unknown) => boolean | undefined) => {
				for (const message of state.messages) {
					if (callback(message) === false) return;
				}
			},
		}),
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: 'me'}}));
vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/member/state/MemberSearch', () => ({
	default: {
		initialize: vi.fn(),
		getSearchContext: vi.fn(() => ({
			search: vi.fn(),
			beginSearch: vi.fn(),
			cancelSearch: vi.fn(),
			destroy: vi.fn(),
		})),
	},
}));

import {Channel} from '@app/features/channel/models/Channel';
import {useLexicalAutocomplete} from '@app/features/lexical/composer/useLexicalAutocomplete';
import {addTestPersona} from '@app/features/persona/state/__fixtures__/PersonaTestFixtures';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const I18N = {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'} as any;
const CHANNEL = new Channel({id: '1546500000000000099', name: 'general', type: 0, guild_id: '1546500000000000001'});

function message(authorId: string, persona: {id: string; name: string; visibility?: string}, at: number) {
	return {
		subprofile: {id: persona.id, name: persona.name, visibility: persona.visibility ?? 'unlisted'},
		author: {id: authorId, username: authorId, discriminator: null, globalName: null},
		timestamp: new Date(at),
	};
}

describe('useLexicalAutocomplete with personas from recent messages', () => {
	let root: Root;
	let container: HTMLDivElement;

	beforeEach(() => {
		state.results = [];
		state.messages = [];
		PersonaStore.setPersonas([]);
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	async function suggestedPersonas(): Promise<Array<{name: string; last_used_at_ms?: string | null}>> {
		let hookResult: ReturnType<typeof useLexicalAutocomplete> | null = null;
		const handleRef = {
			current: {
				getTextUpToCursor: () => '@',
				getActiveSlotAutocompleteContext: () => null,
				getActiveOptionalContext: () => null,
				insertPayload: vi.fn(),
				replaceTextRange: vi.fn(),
			} as any,
		};
		function TestHarness() {
			hookResult = useLexicalAutocomplete({channel: CHANNEL, i18n: I18N, handleRef});
			return null;
		}
		await act(async () => {
			root.render(<TestHarness data-flx="lexical.composer.use-lexical-autocomplete-recent-personas-test.harness" />);
		});
		return hookResult!.autocompleteOptions.flatMap((option: any) =>
			option.type === 'mention' && option.kind === 'persona' ? [option.persona] : [],
		);
	}

	it("never adds another account's persona from a message, private or a copy set to nobody", async () => {
		state.messages = [
			message('friend', {id: 'p_secret', name: 'Secret', visibility: 'private'}, 3000),
			message('friend', {id: 'p_clone', name: 'Clone'}, 2000),
		];
		expect(await suggestedPersonas()).toEqual([]);
	});

	it("ranks another account's persona the server returned by when it last spoke here", async () => {
		state.results = [
			{id: 'p_old', name: 'Old', owner_user_id: 'friend', owner_username: 'friend', use_count: 0},
			{id: 'p_recent', name: 'Recent', owner_user_id: 'friend', owner_username: 'friend', use_count: 0},
		];
		state.messages = [message('friend', {id: 'p_recent', name: 'Recent'}, Date.now())];
		const suggested = await suggestedPersonas();
		expect(suggested.map((p) => p.name)).toEqual(['Recent', 'Old']);
	});

	it('adds the account’s own personas from its store, unless they are set to nobody', async () => {
		addTestPersona(PersonaStore, {id: 'p_mine', name: 'Mine'});
		addTestPersona(PersonaStore, {id: 'p_quiet', name: 'Quiet', mentionable_by: 'nobody'});
		addTestPersona(PersonaStore, {id: 'p_private', name: 'Private', visibility: 'private'});
		state.messages = [
			message('me', {id: 'p_mine', name: 'Mine'}, 3000),
			message('me', {id: 'p_quiet', name: 'Quiet'}, 2000),
			message('me', {id: 'p_private', name: 'Private', visibility: 'private'}, 1000),
			message('me', {id: 'p_deleted', name: 'Deleted'}, 500),
		];
		expect((await suggestedPersonas()).map((p) => p.name).sort()).toEqual(['Mine', 'Private']);
	});
});
