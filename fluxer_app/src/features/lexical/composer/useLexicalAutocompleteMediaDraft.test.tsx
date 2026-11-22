// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: the composer's autocomplete lists stickers, saved media and GIFs only while the composer
// holds nothing else, and a pick of one made after text was added does nothing (tyne-chat/tyne#770).

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

const EMOJI = vi.hoisted(() => ({type: 'emoji', emoji: {name: 'sticky', uniqueName: 'sticky', surrogates: '🩹'}}));
const STICKER = vi.hoisted(() => ({type: 'sticker', sticker: {id: 's1'}}));
const MEME = vi.hoisted(() => ({type: 'meme', meme: {id: 'm1'}}));
const GIF = vi.hoisted(() => ({type: 'gif', gif: {url: 'https://example.invalid/cat.gif', title: 'Cat'}}));

vi.mock('@app/features/messaging/utils/AutocompleteOptionBuilders', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/messaging/utils/AutocompleteOptionBuilders')>()),
	buildEmojiAutocompleteOptions: () => [EMOJI, STICKER, MEME],
}));
vi.mock('@app/features/lexical/composer/useAutocompleteGifSearch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/lexical/composer/useAutocompleteGifSearch')>()),
	useAutocompleteGifSearch: () => undefined,
	selectAutocompleteGifResults: () => [GIF.gif],
}));
vi.mock('@app/features/lexical/composer/useAutocompletePersonaSearch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/lexical/composer/useAutocompletePersonaSearch')>()),
	useAutocompletePersonaSearch: () => [],
}));
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
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const I18N = {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'} as any;
const CHANNEL = new Channel({id: '1546500000000000098', name: 'general', type: 0, guild_id: '1546500000000000001'});

describe('useLexicalAutocomplete media entries and the rest of the composer (tyne-chat/tyne#770)', () => {
	let root: Root;
	let container: HTMLDivElement;
	let composer: {before: string; after: string};
	let handle: Record<string, ReturnType<typeof vi.fn>>;

	beforeEach(() => {
		PersonaStore.setPersonas([]);
		addTestPersona(PersonaStore, {name: 'Alice', persona_tags: [{prefix: 'a:'}]});
		composer = {before: '', after: ''};
		handle = {
			getTextUpToCursor: vi.fn(() => composer.before),
			getDisplayValue: vi.fn(() => composer.before + composer.after),
			getWireValue: vi.fn(() => composer.before + composer.after),
			getActiveSlotAutocompleteContext: vi.fn(() => null),
			getActiveOptionalContext: vi.fn(() => null),
			clear: vi.fn(),
			replaceRange: vi.fn(),
			applySlotPayload: vi.fn(),
			applySlotChoice: vi.fn(),
			applyOptionalChoice: vi.fn(),
			insertSlashCommand: vi.fn(),
		};
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		PersonaStore.setPersonas([]);
	});

	async function render(before: string, after = '') {
		composer = {before, after};
		const result: {current: ReturnType<typeof useLexicalAutocomplete> | null} = {current: null};
		const handleRef = {current: handle as any};
		function TestHarness() {
			result.current = useLexicalAutocomplete({channel: CHANNEL, i18n: I18N, handleRef});
			return null;
		}
		await act(async () => {
			root.render(<TestHarness data-flx="lexical.composer.use-lexical-autocomplete-media-draft-test.harness" />);
		});
		return result;
	}

	function types(result: {current: ReturnType<typeof useLexicalAutocomplete> | null}): Array<string> {
		return result.current!.autocompleteOptions.map((option) => option.type);
	}

	it('lists emoji, stickers and saved media in an empty composer', async () => {
		expect(types(await render(':stic'))).toEqual(['emoji', 'sticker', 'meme']);
	});

	it('lists them when the rest is whitespace or a lone persona tag', async () => {
		expect(types(await render('   :stic', '  '))).toEqual(['emoji', 'sticker', 'meme']);
		expect(types(await render('a: :stic'))).toEqual(['emoji', 'sticker', 'meme']);
	});

	it('lists only the emoji when the composer holds other text', async () => {
		expect(types(await render('hello :stic'))).toEqual(['emoji']);
		expect(types(await render(':stic', ' hello'))).toEqual(['emoji']);
		expect(types(await render('a: hello :stic'))).toEqual(['emoji']);
	});

	it('lists GIFs from /gif only with nothing after the caret', async () => {
		expect(types(await render('/gif cat'))).toEqual(['gif']);
		expect(types(await render('/gif cat', ' hello'))).toEqual([]);
	});

	it('does nothing when a listed sticker, meme or GIF is picked after text was added', async () => {
		const dispatch = vi.spyOn(ComponentBus, 'dispatch');
		try {
			const result = await render(':stic');
			expect(types(result)).toEqual(['emoji', 'sticker', 'meme']);
			// Text typed after the caret leaves the text up to it, and so the list, unchanged.
			composer.after = ' hello';
			for (const option of [STICKER, MEME, GIF]) {
				act(() => {
					result.current!.handleSelect(option as any);
				});
			}
			const mediaDispatches = dispatch.mock.calls.filter(([event]) =>
				['STICKER_SELECT', 'FAVORITE_MEME_SELECT', 'GIF_SELECT'].includes(event as string),
			);
			expect(mediaDispatches).toEqual([]);
			expect(handle.clear).not.toHaveBeenCalled();
		} finally {
			dispatch.mockRestore();
		}
	});

	it('still sends a sticker picked from an empty composer', async () => {
		const dispatch = vi.spyOn(ComponentBus, 'dispatch').mockImplementation(() => {});
		try {
			const result = await render(':stic');
			act(() => {
				result.current!.handleSelect(STICKER as any);
			});
			expect(dispatch).toHaveBeenCalledWith('STICKER_SELECT', {sticker: STICKER.sticker});
			expect(handle.clear).toHaveBeenCalledTimes(1);
		} finally {
			dispatch.mockRestore();
		}
	});
});
