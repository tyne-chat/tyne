// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import type {PersonaGroupResponse} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';
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
	http: {get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), configure: vi.fn()},
}));

installVoiceMenuTestBootstrap();

const PersonaGroupCommands = await import('./PersonaGroupCommands');
const {PersonaGroups} = await import('../state/PersonaGroups');

const group = (id: string, name: string, personaIds: Array<string> = []): PersonaGroupResponse => ({
	id,
	name,
	persona_ids: personaIds,
});

const reply = (body: unknown, status = 200) => ({ok: status < 400, status, headers: {}, body});

// Persona groups (tyne-chat/tyne#829): their requests, counted.
describe('persona group commands', () => {
	beforeEach(() => {
		vi.mocked(http.get).mockReset();
		vi.mocked(http.patch).mockReset();
		vi.mocked(http.post).mockReset();
		PersonaGroups.reset();
	});

	it('loads the list once while a load is on its way', async () => {
		vi.mocked(http.get).mockResolvedValue(reply([group('1', 'Core')]) as never);

		await Promise.all([
			PersonaGroupCommands.fetchPersonaGroups(),
			PersonaGroupCommands.fetchPersonaGroups(),
			PersonaGroupCommands.fetchPersonaGroups(),
		]);

		expect(http.get).toHaveBeenCalledTimes(1);
		expect(http.get).toHaveBeenCalledWith(ForkEndpoints.USER_PERSONA_GROUPS);
		expect(PersonaGroups.loaded).toBe(true);
		expect(PersonaGroups.groups.map((g) => g.name)).toEqual(['Core']);
	});

	it('leaves the list alone after a failed load and asks again only when called again', async () => {
		vi.mocked(http.get).mockResolvedValueOnce(reply({code: 'RATE_LIMITED'}, 429) as never);
		await PersonaGroupCommands.fetchPersonaGroups();
		expect(http.get).toHaveBeenCalledTimes(1);
		expect(PersonaGroups.loaded).toBe(false);
		expect(PersonaGroups.groups).toEqual([]);

		vi.mocked(http.get).mockRejectedValueOnce(new Error('offline'));
		await PersonaGroupCommands.fetchPersonaGroups();
		expect(http.get).toHaveBeenCalledTimes(2);
		expect(PersonaGroups.loaded).toBe(false);
	});

	it('sends nothing for changes that change nothing, and one request for the rest', async () => {
		await PersonaGroupCommands.changePersonaGroupMembers([{groupId: '1', add: [], remove: []}]);
		expect(http.patch).not.toHaveBeenCalled();

		vi.mocked(http.patch).mockResolvedValue(reply([group('1', 'Core', ['10']), group('2', 'Visitors')]) as never);
		await PersonaGroupCommands.changePersonaGroupMembers([
			{groupId: '1', add: ['10']},
			{groupId: '2', remove: ['10']},
			{groupId: '3', add: []},
		]);
		expect(http.patch).toHaveBeenCalledTimes(1);
		expect(http.patch).toHaveBeenCalledWith(ForkEndpoints.USER_PERSONA_GROUP_MEMBERS, {
			body: {
				changes: [
					{group_id: '1', add: ['10']},
					{group_id: '2', remove: ['10']},
				],
			},
		});
		expect(PersonaGroups.groups.map((g) => [g.name, g.persona_ids])).toEqual([
			['Core', ['10']],
			['Visitors', []],
		]);
	});

	it('asks again after a reset instead of sharing a request from before it, and drops that reply', async () => {
		let answerOld: (value: unknown) => void = () => {};
		vi.mocked(http.get).mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)) as never);
		const old = PersonaGroupCommands.fetchPersonaGroups();
		PersonaGroups.reset();
		vi.mocked(http.get).mockResolvedValueOnce(reply([group('2', 'New account’s')]) as never);
		await PersonaGroupCommands.fetchPersonaGroups();
		expect(http.get).toHaveBeenCalledTimes(2);

		answerOld(reply([group('1', 'Old account’s')]));
		await old;
		expect(PersonaGroups.groups.map((g) => g.name)).toEqual(['New account’s']);
	});

	it('sends nothing to rename a group to the name it has', async () => {
		PersonaGroups.setGroups([group('1', 'Core')]);
		await PersonaGroupCommands.renamePersonaGroup('1', 'Core');
		expect(http.patch).not.toHaveBeenCalled();
	});

	it('keeps a new group, and the list the server returns, without waiting for the event', async () => {
		vi.mocked(http.post).mockResolvedValue(reply(group('5', 'Visitors', ['10'])) as never);
		const created = await PersonaGroupCommands.createPersonaGroup('Visitors', ['10']);
		expect(created.id).toBe('5');
		expect(http.post).toHaveBeenCalledWith(ForkEndpoints.USER_PERSONA_GROUPS, {
			body: {name: 'Visitors', persona_ids: ['10']},
		});
		expect(PersonaGroups.groups.map((g) => g.id)).toEqual(['5']);
	});
});
