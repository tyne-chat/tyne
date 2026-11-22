// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: stickers, saved media and GIFs in the autocomplete only while the composer holds nothing
// else (tyne-chat/tyne#770).

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

const http = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
	configure: vi.fn(),
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({http}));

installVoiceMenuTestBootstrap();

const {PersonaStoreClass} = await import('@app/features/persona/state/PersonaStore');
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
const {
	canPickAutocompleteOptionInComposer,
	composerAllowsAutocompleteMedia,
	composerTextOutsideAutocompleteQuery,
	filterAutocompleteMediaForComposer,
} = await import('./AutocompleteMediaDraftGate');
type PersonaStoreInstance = InstanceType<typeof PersonaStoreClass>;

const CHANNEL = 'one';

/** A composer whose text is `before` + `after`, caret between them; `wire` defaults to the display. */
function composer(before: string, after = '', wire?: string) {
	return {
		getDisplayValue: () => before + after,
		getTextUpToCursor: () => before,
		getWireValue: () => wire ?? before + after,
	};
}

const EMOJI = {type: 'emoji', emoji: {name: 'sticky'}} as any;
const STICKER = {type: 'sticker', sticker: {id: 's1'}} as any;
const MEME = {type: 'meme', meme: {id: 'm1'}} as any;
const GIF = {type: 'gif', gif: {url: 'https://example.invalid/cat.gif'}} as any;
const OPTIONS = [EMOJI, STICKER, MEME];

describe('stickers, saved media and GIFs in the composer autocomplete (tyne-chat/tyne#770)', () => {
	let store: PersonaStoreInstance;

	beforeEach(() => {
		for (const mock of [http.get, http.post, http.patch, http.put, http.delete]) {
			mock.mockReset();
			mock.mockResolvedValue({ok: true, status: 200, body: {}});
		}
		store = new PersonaStoreClass();
		addTestPersona(store, {name: 'Alice', persona_tags: [{prefix: 'a:'}]});
	});

	it('lists them all when the composer holds only the query', () => {
		expect(filterAutocompleteMediaForComposer(OPTIONS, composer(':stic'), CHANNEL, store)).toEqual(OPTIONS);
	});

	it('lists them when the rest of the composer is whitespace', () => {
		expect(filterAutocompleteMediaForComposer(OPTIONS, composer('  \n :stic', '  '), CHANNEL, store)).toEqual(OPTIONS);
	});

	it('lists them when the rest is a lone persona tag, which the send uses up', () => {
		expect(filterAutocompleteMediaForComposer(OPTIONS, composer('a: :stic'), CHANNEL, store)).toEqual(OPTIONS);
	});

	it('keeps only the emoji when text was typed before the query', () => {
		expect(filterAutocompleteMediaForComposer(OPTIONS, composer('hello :stic'), CHANNEL, store)).toEqual([EMOJI]);
	});

	it('keeps only the emoji when text follows a persona tag', () => {
		expect(filterAutocompleteMediaForComposer(OPTIONS, composer('a: hello :stic'), CHANNEL, store)).toEqual([EMOJI]);
	});

	it('keeps only the emoji when text follows the caret', () => {
		expect(filterAutocompleteMediaForComposer(OPTIONS, composer(':stic', ' hello'), CHANNEL, store)).toEqual([EMOJI]);
	});

	it('drops GIFs from /gif when text follows the caret, and keeps them without', () => {
		expect(filterAutocompleteMediaForComposer([GIF], composer('/gif cat', ' hello'), CHANNEL, store)).toEqual([]);
		expect(filterAutocompleteMediaForComposer([GIF], composer('/gif cat'), CHANNEL, store)).toEqual([GIF]);
	});

	it('leaves a list without media as it is, without reading the composer', () => {
		const reader = {
			getDisplayValue: vi.fn(() => 'hello :sm'),
			getTextUpToCursor: vi.fn(() => 'hello :sm'),
			getWireValue: vi.fn(() => 'hello :sm'),
		};
		const emojiOnly = [EMOJI];
		expect(filterAutocompleteMediaForComposer(emojiOnly, reader, CHANNEL, store)).toBe(emojiOnly);
		expect(reader.getDisplayValue).not.toHaveBeenCalled();
	});

	it('reads the text outside the query from the wire, so a pill in it reads as what is sent', () => {
		// Display shows an emoji pill as `:cherry:`; the wire holds the emoji itself.
		expect(composerTextOutsideAutocompleteQuery(composer(':cherry: :stic', '', '🌸 :stic'))).toBe('🌸 ');
		expect(composerTextOutsideAutocompleteQuery(composer('hi :stic', ' there'))).toBe('hi  there');
	});

	it('offers none without a composer', () => {
		expect(composerAllowsAutocompleteMedia(null, CHANNEL, store)).toBe(false);
		expect(filterAutocompleteMediaForComposer(OPTIONS, null, CHANNEL, store)).toEqual([EMOJI]);
	});

	it('refuses a pick of media once other text is there, and lets emoji through', () => {
		const busy = composer('hello :stic');
		expect(canPickAutocompleteOptionInComposer(STICKER, busy, CHANNEL, store)).toBe(false);
		expect(canPickAutocompleteOptionInComposer(MEME, busy, CHANNEL, store)).toBe(false);
		expect(canPickAutocompleteOptionInComposer(GIF, busy, CHANNEL, store)).toBe(false);
		expect(canPickAutocompleteOptionInComposer(EMOJI, busy, CHANNEL, store)).toBe(true);
		expect(canPickAutocompleteOptionInComposer(STICKER, composer('a: :stic'), CHANNEL, store)).toBe(true);
	});
});
