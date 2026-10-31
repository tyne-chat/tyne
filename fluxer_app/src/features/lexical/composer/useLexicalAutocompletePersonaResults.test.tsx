// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: personas the server finds arrive after the keystroke that asked for them, and have to show
// without another keystroke (tyne-chat/tyne#150).

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

const search = vi.hoisted(() => ({results: [] as Array<Record<string, unknown>>}));

vi.mock('@app/features/lexical/composer/useAutocompletePersonaSearch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/lexical/composer/useAutocompletePersonaSearch')>()),
	useAutocompletePersonaSearch: () => search.results,
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({default: {getCachedMessages: () => null}}));
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
import {act, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const I18N = {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'} as any;
const CHANNEL = new Channel({
	id: '1546500000000000099',
	name: 'general',
	type: 0,
	guild_id: '1546500000000000001',
});
const FOX = {
	id: 'sub_fox',
	name: 'Foxy',
	user_id: 'author_1',
	username: 'user_one',
	visibility: 'public',
	use_count: 1,
	last_used_at_ms: '1000',
};

describe('useLexicalAutocomplete with personas found by the server', () => {
	let root: Root;
	let container: HTMLDivElement;

	beforeEach(() => {
		search.results = [];
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

	it('shows them when they arrive, with no further typing', async () => {
		let hookResult: ReturnType<typeof useLexicalAutocomplete> | null = null;
		let rerender: () => void = () => {};
		const handleRef = {
			current: {
				getTextUpToCursor: () => '@Fox',
				getActiveSlotAutocompleteContext: () => null,
				getActiveOptionalContext: () => null,
				insertPayload: vi.fn(),
				replaceTextRange: vi.fn(),
			} as any,
		};

		function TestHarness() {
			const [, setTick] = useState(0);
			rerender = () => setTick((tick) => tick + 1);
			hookResult = useLexicalAutocomplete({channel: CHANNEL, i18n: I18N, handleRef});
			return null;
		}

		const personaNames = () =>
			hookResult!.autocompleteOptions.flatMap((option: any) =>
				option.type === 'mention' && option.kind === 'persona' ? [option.persona.name] : [],
			);

		await act(async () => {
			root.render(<TestHarness data-flx="lexical.composer.use-lexical-autocomplete-persona-results-test.harness" />);
		});
		expect(personaNames()).toEqual([]);

		search.results = [FOX];
		await act(async () => {
			rerender();
		});
		expect(personaNames()).toEqual(['Foxy']);
	});
});
