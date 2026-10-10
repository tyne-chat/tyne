// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: a thread carries only the ID of the persona it was started as. "Started by" has to turn
// that into a name from what the client knows, and fall back to the account when it cannot.

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {getSubPreference: () => undefined, setSubPreference: () => Promise.resolve()},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {
		get: vi.fn(),
		post: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		patch: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		delete: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		configure: vi.fn(),
	},
}));

interface LoadedMessage {
	author: {id: string};
	subprofile?: {id: string; name: string} | null;
}
const loaded = new Map<string, Array<LoadedMessage>>();
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {
		version: 0,
		getCachedMessages: (channelId: string) => {
			const messages = loaded.get(channelId);
			return messages ? {forEach: (cb: (message: LoadedMessage) => void) => messages.forEach(cb)} : undefined;
		},
	},
}));

installVoiceMenuTestBootstrap();

import type {Channel} from '@app/features/channel/models/Channel';
import {observer} from 'mobx-react-lite';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

const {PersonaStore} = await import('@app/features/persona/state/PersonaStore');
const {useThreadOwnerPersona} = await import('@app/features/persona/utils/ThreadOwnerPersona');
const {http} = await import('@app/features/platform/transport/RestTransport');

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = '1500000000000000100';
const THREAD = '1500000000000000003';
const PARENT = '1500000000000000002';
const FOX = '1500000000000000009';

function thread(ownerPersonaId: string | null): Channel {
	return {id: THREAD, parentId: PARENT, ownerId: OWNER, ownerPersonaId} as Channel;
}

const StartedBy = observer(({channel}: {channel: Channel}) => {
	const persona = useThreadOwnerPersona(channel);
	return <span data-flx="persona.thread-owner-persona-test.started-by.span">{persona?.name ?? 'account'}</span>;
});

describe('useThreadOwnerPersona', () => {
	let container: HTMLDivElement;
	let root: Root;

	async function render(channel: Channel): Promise<string> {
		await act(async () => {
			root.render(<StartedBy channel={channel} data-flx="persona.thread-owner-persona-test.started-by" />);
		});
		return container.textContent ?? '';
	}

	beforeEach(() => {
		PersonaStore.reset();
		loaded.clear();
		vi.mocked(http.get).mockReset();
		vi.mocked(http.get).mockResolvedValue({ok: false, status: 404, body: null} as never);
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		PersonaStore.reset();
	});

	it('names nobody and looks nothing up for a thread started as the account', async () => {
		expect(await render(thread(null))).toBe('account');
		expect(http.get).not.toHaveBeenCalled();
	});

	it("names one of the user's own personas without a request", async () => {
		const own = await PersonaStore.addPersona({name: 'Fox'});
		expect(await render(thread(own.id))).toBe('Fox');
		expect(http.get).not.toHaveBeenCalled();
	});

	it('names a persona seen before', async () => {
		PersonaStore.recordKnownPersona({id: FOX, name: 'Fox', pronouns: null, color: null});
		expect(await render(thread(FOX))).toBe('Fox');
		expect(http.get).not.toHaveBeenCalled();
	});

	it('takes the name from a message the owner sent as that persona, in the thread or its parent', async () => {
		loaded.set(THREAD, [{author: {id: OWNER}, subprofile: null}]);
		loaded.set(PARENT, [
			{author: {id: '1500000000000000200'}, subprofile: {id: FOX, name: 'Impostor'}},
			{author: {id: OWNER}, subprofile: {id: FOX, name: 'Fox'}},
		]);
		expect(await render(thread(FOX))).toBe('Fox');
		expect(http.get).not.toHaveBeenCalled();
		expect(PersonaStore.getKnownPersona(FOX)?.name).toBe('Fox');
	});

	it('looks the persona up once when nothing loaded names it', async () => {
		vi.mocked(http.get).mockResolvedValue({ok: true, status: 200, body: {id: FOX, name: 'Fox'}} as never);
		await render(thread(FOX));
		expect(await render(thread(FOX))).toBe('Fox');
		expect(http.get).toHaveBeenCalledTimes(1);
	});

	it('falls back to the account when the persona cannot be looked up', async () => {
		expect(await render(thread(FOX))).toBe('account');
		expect(http.get).toHaveBeenCalledTimes(1);
	});
});
