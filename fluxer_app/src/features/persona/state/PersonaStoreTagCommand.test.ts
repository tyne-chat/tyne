// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/app/I18n', () => ({default: {_: (descriptor: {message?: string}) => descriptor.message ?? ''}}));
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

const toast = vi.hoisted(() => ({success: vi.fn(() => 'toast'), error: vi.fn(() => 'toast')}));
vi.mock('@app/features/ui/commands/ToastCommands', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/ui/commands/ToastCommands')>()),
	...toast,
}));

installVoiceMenuTestBootstrap();

const {PersonaStoreClass} = await import('./PersonaStore');
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
type PersonaStoreInstance = InstanceType<typeof PersonaStoreClass>;

const SETTINGS = '/users/@me/personas/settings';
const stateUrl = (channelId: string) => `/users/@me/personas/channel-states/${channelId}`;

// tyne-chat/tyne#628: a message that is only a persona's tag selects that persona and is not sent.
describe('PersonaStore: a persona tag sent on its own', () => {
	let store: PersonaStoreInstance;
	let alice: string;
	let bob: string;

	beforeEach(() => {
		for (const mock of [http.get, http.post, http.patch, http.put, http.delete]) {
			mock.mockReset();
			mock.mockResolvedValue({ok: true, status: 200, body: {}});
		}
		toast.success.mockClear();
		toast.error.mockClear();
		store = new PersonaStoreClass();
		alice = addTestPersona(store, {name: 'Alice', persona_tags: [{prefix: 'a:'}]}).id;
		bob = addTestPersona(store, {name: 'Bob', persona_tags: [{prefix: '[', suffix: ']'}]}).id;
		addTestPersona(store, {name: 'Carol', persona_tags: [{prefix: 'c:'}], auto_tag_disabled: true});
	});

	const requests = () => http.patch.mock.calls.length + http.put.mock.calls.length;

	it('selects the persona with one request and no toast', () => {
		expect(store.handleInChatCommand('one', 'a:')).toEqual({isCommand: true, handled: true});

		expect(store.latchedPersonaFor('one')?.id).toBe(alice);
		expect(store.latchedPersonaFor('two')?.id).toBe(alice);
		expect(http.patch).toHaveBeenCalledTimes(1);
		expect(http.patch).toHaveBeenCalledWith(SETTINGS, {
			body: expect.objectContaining({active_persona_id: alice, is_latched: true}),
		});
		expect(http.put).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('takes a tag with a prefix and a suffix, empty or holding only spaces', () => {
		for (const content of ['[]', '[ ]', '  [  ]  ']) {
			store.updateSettings({active_persona_id: null, is_latched: false});
			expect(store.handleInChatCommand('one', content).handled).toBe(true);
			expect(store.latchedPersonaFor('one')?.id).toBe(bob);
		}
	});

	it('takes a prefix tag followed by spaces', () => {
		expect(store.handleInChatCommand('one', 'a:   ').handled).toBe(true);
		expect(store.latchedPersonaFor('one')?.id).toBe(alice);
	});

	it('leaves a tag with text, plain text, an escaped tag and a tag nobody owns to be sent', () => {
		for (const content of ['a: hello', '[hello]', 'hello', '\\a:', 'z:', 'a:b']) {
			expect(store.handleInChatCommand('one', content).handled).toBe(false);
		}
		expect(store.latchedPersonaFor('one')).toBeNull();
		expect(requests()).toBe(0);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('ignores the tags of a persona set not to match them, as sending does', () => {
		expect(store.handleInChatCommand('one', 'c:').handled).toBe(false);
		expect(store.latchedPersonaFor('one')).toBeNull();
		expect(requests()).toBe(0);
	});

	it('leaves a tag with an attachment, sticker or meme to name who sends them', () => {
		expect(store.handleInChatCommand('one', 'a:', true).handled).toBe(false);
		expect(store.latchedPersonaFor('one')).toBeNull();
		expect(requests()).toBe(0);
	});

	it('sends no request when the persona is already selected', async () => {
		await store.setActivePersona(alice, true);
		http.patch.mockClear();

		expect(store.handleInChatCommand('one', 'a:').handled).toBe(true);

		expect(store.latchedPersonaFor('one')?.id).toBe(alice);
		expect(requests()).toBe(0);
	});

	it('switches from another selected persona', async () => {
		await store.setActivePersona(bob, true);
		http.patch.mockClear();

		expect(store.handleInChatCommand('one', 'a:').handled).toBe(true);

		expect(store.latchedPersonaFor('one')?.id).toBe(alice);
		expect(http.patch).toHaveBeenCalledTimes(1);
	});

	it('keeps "last used" mode', () => {
		store.updateSettings({active_persona_mode: 'last'});

		expect(store.handleInChatCommand('one', 'a:').handled).toBe(true);

		expect(store.activePersonaMode).toBe('last');
		expect(http.patch).toHaveBeenCalledWith(SETTINGS, {
			body: expect.objectContaining({active_persona_id: alice, active_persona_mode: 'last'}),
		});
	});

	it('selects in that channel only when selections are kept per channel', () => {
		store.updateSettings({active_persona_scope: 'channel'});

		expect(store.handleInChatCommand('one', '[]').handled).toBe(true);

		expect(store.latchedPersonaFor('one')?.id).toBe(bob);
		expect(store.latchedPersonaFor('two')).toBeNull();
		expect(http.put).toHaveBeenCalledTimes(1);
		expect(http.put).toHaveBeenCalledWith(stateUrl('one'), {body: {persona_id: bob}});
		expect(http.patch).not.toHaveBeenCalled();
	});

	it('rolls back once and does not retry when the request fails', async () => {
		http.patch.mockRejectedValueOnce(new Error('429'));

		expect(store.handleInChatCommand('one', 'a:').handled).toBe(true);
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		expect(store.latchedPersonaFor('one')).toBeNull();
		expect(http.patch).toHaveBeenCalledTimes(1);
	});
});
