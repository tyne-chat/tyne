// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import {http} from '@app/features/platform/transport/RestTransport';
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
vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {getSubPreference: () => undefined, setSubPreference: () => Promise.resolve(), isHydrated: true},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), configure: vi.fn()},
}));

const remarks = vi.hoisted(() => ({count: 0}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({
	default: {
		handleRelationshipUpdate: () => {
			remarks.count += 1;
			return false;
		},
	},
}));

installVoiceMenuTestBootstrap();

const PersonaBlockCommands = await import('./PersonaBlockCommands');
const {PersonaBlocks} = await import('../state/PersonaBlocks');
const {isMessageAuthorBlocked} = await import('../utils/MessageAuthorBlocked');

const reply = (body: unknown, status = 200) => ({ok: status < 400, status, headers: {}, body});

// Blocked personas (tyne-chat/tyne#921): their requests, counted, and the messages re-marked.
describe('persona block commands', () => {
	beforeEach(() => {
		vi.mocked(http.get).mockReset();
		vi.mocked(http.put).mockReset();
		vi.mocked(http.delete).mockReset();
		remarks.count = 0;
		PersonaBlocks.reset();
	});

	it('loads the list once while a load is on its way, and re-marks the loaded messages', async () => {
		vi.mocked(http.get).mockResolvedValue(reply([{user_id: '1', persona_id: '10'}]) as never);

		await Promise.all([
			PersonaBlockCommands.fetchPersonaBlocks(),
			PersonaBlockCommands.fetchPersonaBlocks(),
			PersonaBlockCommands.fetchPersonaBlocks(),
		]);

		expect(http.get).toHaveBeenCalledTimes(1);
		expect(http.get).toHaveBeenCalledWith(ForkEndpoints.USER_PERSONA_BLOCKS);
		expect(PersonaBlocks.loaded).toBe(true);
		expect(PersonaBlocks.isBlocked('1', '10')).toBe(true);
		expect(remarks.count).toBe(1);
	});

	it('leaves the list alone after a failed load and asks again only when called again', async () => {
		vi.mocked(http.get).mockResolvedValueOnce(reply({code: 'RATE_LIMITED'}, 429) as never);
		await PersonaBlockCommands.fetchPersonaBlocks();
		expect(http.get).toHaveBeenCalledTimes(1);
		expect(PersonaBlocks.loaded).toBe(false);

		vi.mocked(http.get).mockRejectedValueOnce(new Error('offline'));
		await PersonaBlockCommands.fetchPersonaBlocks();
		expect(http.get).toHaveBeenCalledTimes(2);
		expect(PersonaBlocks.loaded).toBe(false);
	});

	it('drops a reply that arrives after the list was reset', async () => {
		let resolve: (value: unknown) => void = () => {};
		vi.mocked(http.get).mockReturnValue(new Promise((r) => (resolve = r)) as never);
		const load = PersonaBlockCommands.fetchPersonaBlocks();
		PersonaBlocks.reset();
		resolve(reply([{user_id: '1', persona_id: '10'}]));
		await load;
		expect(PersonaBlocks.isBlocked('1', '10')).toBe(false);
		expect(PersonaBlocks.loaded).toBe(false);
	});

	it('blocks and unblocks with one request each, taking the list the server returns', async () => {
		vi.mocked(http.put).mockResolvedValue(reply([{user_id: '1', persona_id: '10'}]) as never);
		await PersonaBlockCommands.blockPersona('1', '10');
		expect(http.put).toHaveBeenCalledTimes(1);
		expect(http.put).toHaveBeenCalledWith(ForkEndpoints.USER_PERSONA_BLOCK('1', '10'));
		expect(PersonaBlocks.isBlocked('1', '10')).toBe(true);
		expect(remarks.count).toBe(1);

		vi.mocked(http.delete).mockResolvedValue(reply([]) as never);
		await PersonaBlockCommands.unblockPersona('1', '10');
		expect(http.delete).toHaveBeenCalledTimes(1);
		expect(PersonaBlocks.isBlocked('1', '10')).toBe(false);
	});

	it('throws on a failed block, without retrying or changing the list', async () => {
		vi.mocked(http.put).mockResolvedValue(reply({code: 'UNKNOWN_PERSONA'}, 404) as never);
		await expect(PersonaBlockCommands.blockPersona('1', '10')).rejects.toThrow();
		expect(http.put).toHaveBeenCalledTimes(1);
		expect(PersonaBlocks.isBlocked('1', '10')).toBe(false);
	});

	it('counts a message as blocked only for the blocked persona of that account', () => {
		PersonaBlocks.setBlocks([{user_id: '1', persona_id: '10'}]);
		expect(isMessageAuthorBlocked({author: {id: '1'}, subprofile: {id: '10'}})).toBe(true);
		expect(isMessageAuthorBlocked({author: {id: '1'}, subprofile: {id: '11'}})).toBe(false);
		expect(isMessageAuthorBlocked({author: {id: '1'}, subprofile: null})).toBe(false);
		// Persona ids are unique only within their account.
		expect(isMessageAuthorBlocked({author: {id: '2'}, subprofile: {id: '10'}})).toBe(false);
	});
});
