// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

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

const {PersonaStoreClass} = await import('./PersonaStore');
type PersonaStoreInstance = InstanceType<typeof PersonaStoreClass>;

const SETTINGS = '/users/@me/personas/settings';
const stateUrl = (channelId: string) => `/users/@me/personas/channel-states/${channelId}`;

describe('PersonaStore with a persona remembered per channel', () => {
	let store: PersonaStoreInstance;
	let alice: string;
	let bob: string;

	beforeEach(async () => {
		for (const mock of [http.get, http.post, http.patch, http.put, http.delete]) {
			mock.mockReset();
			mock.mockResolvedValue({ok: true, status: 200, body: {}});
		}
		store = new PersonaStoreClass();
		alice = (await store.addPersona({name: 'Alice', persona_tags: [{prefix: 'a:'}]})).id;
		bob = (await store.addPersona({name: 'Bob', persona_tags: [{prefix: 'b:'}]})).id;
	});

	const perChannel = () => store.updateSettings({active_persona_scope: 'channel'});

	it('uses the one selection for every channel until the scope is changed', async () => {
		await store.setActivePersona(alice, true, undefined, 'one');
		expect(store.activePersona?.id).toBe(alice);
		expect(store.latchedPersonaFor('one')?.id).toBe(alice);
		expect(store.latchedPersonaFor('two')?.id).toBe(alice);
		expect(store.latchedPersonaFor(null)?.id).toBe(alice);
		expect(http.put).not.toHaveBeenCalled();
	});

	it('starts every channel as the account, whatever was selected for every channel before', async () => {
		await store.setActivePersona(alice, true);
		perChannel();
		expect(store.latchedPersonaFor('one')).toBeNull();
		expect(store.latchedPersonaFor(null)).toBeNull();
		expect(store.getActiveSubprofile('one')).toBeNull();
		expect(store.getEffectivePersonaForText('one', 'hello').persona).toBeNull();
	});

	it('selects a persona in one channel only and leaves the selection for every channel alone', async () => {
		await store.setActivePersona(alice, true);
		http.patch.mockClear();
		perChannel();

		await store.setActivePersona(bob, true, undefined, 'one');

		expect(store.latchedPersonaFor('one')?.id).toBe(bob);
		expect(store.latchedPersonaFor('two')).toBeNull();
		expect(http.put).toHaveBeenCalledWith(stateUrl('one'), {body: {persona_id: bob}});
		expect(http.patch).not.toHaveBeenCalledWith(SETTINGS, expect.anything());
		// Still there for when the scope is switched back.
		expect(store.activePersona?.id).toBe(alice);
		expect(store.getActiveSubprofile('one')?.id).toBe(bob);
		expect(store.getEffectiveReactionPersona('one', null, null)?.id).toBe(bob);
		expect(store.getEffectiveReactionPersona('two', null, null)).toBeNull();
	});

	it('goes back to the account in a channel', async () => {
		perChannel();
		await store.setActivePersona(bob, true, undefined, 'one');
		await store.unlatch(false, 'one');
		expect(store.latchedPersonaFor('one')).toBeNull();
		expect(http.put).toHaveBeenLastCalledWith(stateUrl('one'), {body: {persona_id: null}});
	});

	it('follows the last persona used in the channel it was used in', () => {
		store.updateSettings({active_persona_scope: 'channel', active_persona_mode: 'last'});

		const result = store.matchOutgoingMessage('one', 'b: hello');

		expect(result.persona?.id).toBe(bob);
		expect(store.latchedPersonaFor('one')?.id).toBe(bob);
		expect(store.latchedPersonaFor('two')).toBeNull();
		expect(store.matchOutgoingMessage('one', 'again').persona?.id).toBe(bob);
		expect(store.matchOutgoingMessage('two', 'elsewhere').matched).toBe(false);
	});

	it('clears only that channel with the backslash command', async () => {
		perChannel();
		await store.setActivePersona(alice, true, undefined, 'one');
		await store.setActivePersona(bob, true, undefined, 'two');

		expect(store.handleInChatCommand('one', '\\\\').handled).toBe(true);

		expect(store.latchedPersonaFor('one')).toBeNull();
		expect(store.latchedPersonaFor('two')?.id).toBe(bob);
		expect(store.handleInChatCommand('one', '\\\\').handled).toBe(false);
	});

	it('takes what another session selected, and what was loaded', () => {
		perChannel();
		store.setChannelStates([
			{channel_id: 'one', persona_id: alice},
			{channel_id: 'two', persona_id: bob},
		]);
		expect(store.latchedPersonaFor('one')?.id).toBe(alice);

		store.handleChannelStateUpdate({channel_id: 'one', persona_id: bob});
		store.handleChannelStateUpdate({channel_id: 'two', persona_id: null});
		expect(store.latchedPersonaFor('one')?.id).toBe(bob);
		expect(store.latchedPersonaFor('two')).toBeNull();
		expect(http.put).not.toHaveBeenCalled();
	});

	it('treats a channel whose persona no longer exists as the account', () => {
		perChannel();
		store.setChannelStates([{channel_id: 'one', persona_id: '999'}]);
		expect(store.latchedPersonaFor('one')).toBeNull();
	});

	it('asks the server what holds when a selection could not be saved', async () => {
		perChannel();
		store.setChannelStates([{channel_id: 'one', persona_id: alice}]);
		http.put.mockRejectedValueOnce(new Error('offline'));
		http.get.mockResolvedValueOnce({ok: true, status: 200, body: {states: [{channel_id: 'one', persona_id: alice}]}});

		await store.setActivePersona(bob, true, undefined, 'one');

		expect(http.get).toHaveBeenCalledWith('/users/@me/personas/channel-states');
		expect(store.latchedPersonaFor('one')?.id).toBe(alice);
	});

	it('starts a new thread as whoever opened it, only when personas are kept per channel', () => {
		store.startChannelAs('thread', bob);
		expect(http.put).not.toHaveBeenCalled();

		perChannel();
		store.startChannelAs('thread', bob);
		store.startChannelAs('other-thread', null);
		expect(store.latchedPersonaFor('thread')?.id).toBe(bob);
		expect(store.latchedPersonaFor('other-thread')).toBeNull();
		expect(http.put).toHaveBeenCalledTimes(1);
	});

	it('saves the scope, and puts it back if that fails', async () => {
		await store.setActivePersonaScope('channel');
		expect(store.activePersonaScope).toBe('channel');
		expect(http.patch).toHaveBeenLastCalledWith(SETTINGS, {body: {active_persona_scope: 'channel'}});

		http.patch.mockRejectedValueOnce(new Error('offline'));
		await store.setActivePersonaScope('global');
		expect(store.activePersonaScope).toBe('channel');
	});
});
