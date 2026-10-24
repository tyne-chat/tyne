// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
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
	default: {getSubPreference: () => undefined, setSubPreference: () => Promise.resolve(), isHydrated: () => true},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), configure: vi.fn()},
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {
		handlePersonaUpdate: vi.fn(),
		handleAuthorDisplayTagUpdate: vi.fn(),
		getPersonaIdsByAuthor: vi.fn(() => []),
	},
}));

installVoiceMenuTestBootstrap();

const {http} = await import('@app/features/platform/transport/RestTransport');
const Messages = (await import('@app/features/messaging/state/MessagingMessages')).default;
const {PersonaStore} = await import('../state/PersonaStore');
const {handleGuildPersonasDirty} = await import('./PersonaEvents');
const {PERSONA_REFRESH_DELAY_MS} = await import('./PersonaRefresh');

const OWNER = '1500000000000000001';
const FOX = '1600000000000000001';
const WOLF = '1600000000000000002';
const context = {} as GatewayHandlerContext;

/** One edit as the server sends it: once per shared community, plus once for direct messages. */
function editEvents(copies: number, extra: Record<string, unknown> = {}): void {
	for (let i = 0; i < copies; i++) {
		handleGuildPersonasDirty(
			{guild_id: i < copies - 1 ? `guild-${i}` : undefined, user_id: OWNER, action: 'update', ...extra},
			context,
		);
	}
}

async function afterRefreshDelay(): Promise<void> {
	await vi.advanceTimersByTimeAsync(PERSONA_REFRESH_DELAY_MS + 100);
}

function answerWith(items: Array<Record<string, unknown>>): void {
	vi.mocked(http.post).mockResolvedValue({ok: true, status: 200, headers: {}, body: items});
}

// The server no longer says which persona changed, so a client that shows an account's personas
// fetches them again. These tests count the requests that causes (tyne-tools#7).
describe('Fetching an account’s personas again after it changed them', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		PersonaStore.reset();
		vi.clearAllMocks();
		vi.mocked(Messages.getPersonaIdsByAuthor).mockReturnValue([]);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('sends one request for an edit that arrives once per shared community', async () => {
		vi.mocked(Messages.getPersonaIdsByAuthor).mockReturnValue([FOX]);
		PersonaStore.recordKnownPersona({id: WOLF, name: 'Wolf'}, OWNER);
		answerWith([{id: FOX, user_id: OWNER, name: 'Fox renamed'}]);

		editEvents(9);
		await afterRefreshDelay();

		expect(http.post).toHaveBeenCalledTimes(1);
		const [, options] = vi.mocked(http.post).mock.calls[0];
		expect((options as {body: {personas: Array<unknown>}}).body.personas).toEqual(
			expect.arrayContaining([
				{user_id: OWNER, persona_id: FOX},
				{user_id: OWNER, persona_id: WOLF},
			]),
		);
		expect(Messages.handlePersonaUpdate).toHaveBeenCalledWith({persona: {id: FOX, name: 'Fox renamed'}});
		expect(PersonaStore.getKnownPersona(FOX)?.name).toBe('Fox renamed');
	});

	it('sends nothing when it shows none of the account’s personas', async () => {
		editEvents(3);
		await afterRefreshDelay();

		expect(http.post).not.toHaveBeenCalled();
	});

	it('sends nothing for a delete, which old messages show as it was', async () => {
		vi.mocked(Messages.getPersonaIdsByAuthor).mockReturnValue([FOX]);

		handleGuildPersonasDirty({user_id: OWNER, action: 'delete'}, context);
		await afterRefreshDelay();

		expect(http.post).not.toHaveBeenCalled();
	});

	it('uses a persona the event carries without a request', async () => {
		vi.mocked(Messages.getPersonaIdsByAuthor).mockReturnValue([FOX]);

		editEvents(2, {persona: {id: FOX, name: 'Fox (public)', visibility: 'public'}});
		await afterRefreshDelay();

		expect(http.post).not.toHaveBeenCalled();
		expect(Messages.handlePersonaUpdate).toHaveBeenCalledWith({
			persona: expect.objectContaining({id: FOX, name: 'Fox (public)'}),
		});
	});

	it('does not ask again right after a failed request, on the next edit', async () => {
		vi.mocked(Messages.getPersonaIdsByAuthor).mockReturnValue([FOX]);
		vi.mocked(http.post).mockRejectedValue(new Error('429'));

		editEvents(1);
		await afterRefreshDelay();
		editEvents(1);
		await afterRefreshDelay();

		expect(http.post).toHaveBeenCalledTimes(1);
	});

	it('sends one request per edit when edits come apart', async () => {
		vi.mocked(Messages.getPersonaIdsByAuthor).mockReturnValue([FOX]);
		answerWith([{id: FOX, user_id: OWNER, name: 'Fox'}]);

		editEvents(1);
		await afterRefreshDelay();
		editEvents(1);
		await afterRefreshDelay();

		expect(http.post).toHaveBeenCalledTimes(2);
	});
});
