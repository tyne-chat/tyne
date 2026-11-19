// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createUserID} from '@app/api/BrandedTypes';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {getPersonaRepository} from '@app/api/middleware/ForkServiceSingletons';
import {loadPersonaGroups, writePersonaGroups} from '@app/api/persona/PersonaGroupStore';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {forkUserDeletionCleanups} from '@app/api/user/services/ForkUserDeletionCleanups';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {
	PERSONA_GROUPS_MAX,
	type PersonaGroupListResponse,
	type PersonaGroupResponse,
} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

describe('persona groups (tyne-chat/tyne#829)', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	const createPersona = (account: TestAccount, name: string): Promise<PersonaResponse> =>
		createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({name})
			.expect(HTTP_STATUS.CREATED)
			.execute();

	const createGroup = (account: TestAccount, name: string, personaIds?: Array<string>) =>
		createBuilder<PersonaGroupResponse>(harness, account.token)
			.post('/users/@me/personas/groups')
			.body(personaIds ? {name, persona_ids: personaIds} : {name});

	const listGroups = (account: TestAccount): Promise<PersonaGroupListResponse> =>
		createBuilder<PersonaGroupListResponse>(harness, account.token).get('/users/@me/personas/groups').execute();

	const changeMembers = (
		account: TestAccount,
		changes: Array<{group_id: string; add?: Array<string>; remove?: Array<string>}>,
	) =>
		createBuilder<PersonaGroupListResponse>(harness, account.token)
			.patch('/users/@me/personas/groups/members')
			.body({changes});

	/** Each group's name with the names of its personas, in order. */
	const shape = async (account: TestAccount, personas: Array<PersonaResponse>) => {
		const names = new Map(personas.map((p) => [p.id, p.name]));
		return (await listGroups(account)).map((group) => [group.name, group.persona_ids.map((id) => names.get(id) ?? id)]);
	};

	it('makes, lists in the order made, renames and deletes groups', async () => {
		const account = await createTestAccount(harness);
		expect(await listGroups(account)).toEqual([]);

		const core = await createGroup(account, 'Core').expect(HTTP_STATUS.CREATED).execute();
		const visitors = await createGroup(account, 'Visitors').expect(HTTP_STATUS.CREATED).execute();
		expect(core.persona_ids).toEqual([]);
		expect((await listGroups(account)).map((group) => group.name)).toEqual(['Core', 'Visitors']);

		const renamed = await createBuilder<PersonaGroupResponse>(harness, account.token)
			.patch(`/users/@me/personas/groups/${visitors.id}`)
			.body({name: 'Travellers'})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(renamed).toEqual({id: visitors.id, name: 'Travellers', persona_ids: []});

		await createBuilder(harness, account.token)
			.delete(`/users/@me/personas/groups/${core.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect((await listGroups(account)).map((group) => group.name)).toEqual(['Travellers']);
	});

	it('puts personas in groups and takes them out, across groups, in one request', async () => {
		const account = await createTestAccount(harness);
		const personas = await Promise.all(['Wren', 'Marlowe', 'Lyra', 'Pax'].map((name) => createPersona(account, name)));
		const [wren, marlowe, lyra, pax] = personas;
		const core = await createGroup(account, 'Core', [wren.id, marlowe.id]).expect(HTTP_STATUS.CREATED).execute();
		const visitors = await createGroup(account, 'Visitors').expect(HTTP_STATUS.CREATED).execute();

		const result = await changeMembers(account, [
			{group_id: visitors.id, add: [lyra.id, pax.id, marlowe.id]},
			{group_id: core.id, remove: [wren.id]},
		])
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(result.map((group) => group.name)).toEqual(['Core', 'Visitors']);
		expect(await shape(account, personas)).toEqual([
			['Core', ['Marlowe']],
			['Visitors', ['Lyra', 'Pax', 'Marlowe']],
		]);

		// Adding a persona that is already there keeps one copy, in its place.
		await changeMembers(account, [{group_id: visitors.id, add: [lyra.id]}])
			.expect(HTTP_STATUS.OK)
			.execute();
		expect((await shape(account, personas))[1]).toEqual(['Visitors', ['Lyra', 'Pax', 'Marlowe']]);
	});

	it('changes nothing when one group or one persona is not the caller’s', async () => {
		const owner = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const mine = await createPersona(owner, 'Mine');
		const theirs = await createPersona(other, 'Theirs');
		const group = await createGroup(owner, 'Core').expect(HTTP_STATUS.CREATED).execute();
		const theirGroup = await createGroup(other, 'Theirs').expect(HTTP_STATUS.CREATED).execute();

		await changeMembers(owner, [
			{group_id: group.id, add: [mine.id]},
			{group_id: theirGroup.id, add: [mine.id]},
		])
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA_GROUP')
			.execute();
		await changeMembers(owner, [{group_id: group.id, add: [mine.id, theirs.id]}])
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
		await createGroup(owner, 'Stolen', [theirs.id]).expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA').execute();

		expect(await listGroups(owner)).toEqual([{id: group.id, name: 'Core', persona_ids: []}]);
		expect(await listGroups(other)).toEqual([{id: theirGroup.id, name: 'Theirs', persona_ids: []}]);

		await createBuilder(harness, owner.token)
			.patch(`/users/@me/personas/groups/${theirGroup.id}`)
			.body({name: 'Mine now'})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA_GROUP')
			.execute();
		await createBuilder(harness, owner.token)
			.delete(`/users/@me/personas/groups/${theirGroup.id}`)
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA_GROUP')
			.execute();
		expect((await listGroups(other)).map((g) => g.name)).toEqual(['Theirs']);
	});

	it('keeps a deleted persona in its groups, so that restoring it puts it back, but adds no deleted one', async () => {
		const account = await createTestAccount(harness);
		const lyra = await createPersona(account, 'Lyra');
		const group = await createGroup(account, 'Visitors', [lyra.id]).expect(HTTP_STATUS.CREATED).execute();

		await createBuilder(harness, account.token)
			.delete(`/users/@me/personas/${lyra.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect((await listGroups(account))[0].persona_ids).toEqual([lyra.id]);

		const other = await createGroup(account, 'Other').expect(HTTP_STATUS.CREATED).execute();
		await changeMembers(account, [{group_id: other.id, add: [lyra.id]}])
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();

		// Taking a deleted persona out is allowed.
		await changeMembers(account, [{group_id: group.id, remove: [lyra.id]}])
			.expect(HTTP_STATUS.OK)
			.execute();
		expect((await listGroups(account))[0].persona_ids).toEqual([]);
	});

	it('refuses a group past the limit', async () => {
		const account = await createTestAccount(harness);
		const userId = createUserID(BigInt(account.userId));
		await writePersonaGroups(userId, {
			upsert: Array.from({length: PERSONA_GROUPS_MAX}, (_, i) => ({
				user_id: userId,
				group_id: BigInt(1000 + i),
				name: `Group ${i}`,
				persona_ids: '[]',
				updated_at: new Date(),
			})),
		});

		await createGroup(account, 'One more').expect(HTTP_STATUS.BAD_REQUEST, 'PERSONA_GROUP_LIMIT_REACHED').execute();
		expect(await listGroups(account)).toHaveLength(PERSONA_GROUPS_MAX);
	});

	it('tells only the owner’s sessions, once per change, with the whole list', async () => {
		const {owner} = await setupTestGuildWithMembers(harness, 1);
		const persona = await createPersona(owner, 'Lyra');
		const guildDispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
		const presence = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');

		const core = await createGroup(owner, 'Core').expect(HTTP_STATUS.CREATED).execute();
		const visitors = await createGroup(owner, 'Visitors').expect(HTTP_STATUS.CREATED).execute();
		await changeMembers(owner, [{group_id: visitors.id, add: [persona.id]}])
			.expect(HTTP_STATUS.OK)
			.execute();

		const events = presence.mock.calls
			.map(([call]) => call)
			.filter((call) => call.event === 'USER_PERSONA_GROUPS_UPDATE');
		expect(events).toHaveLength(3);
		expect(events.every((call) => call.userId.toString() === owner.userId.toString())).toBe(true);
		expect(events[2].data).toEqual({
			groups: [
				{id: core.id, name: 'Core', persona_ids: []},
				{id: visitors.id, name: 'Visitors', persona_ids: [persona.id]},
			],
		});
		expect(guildDispatch).not.toHaveBeenCalled();
	});

	it('needs personas.write for a bearer token to change groups', async () => {
		const owner = await createTestAccount(harness);
		const token = await createBuilder<{token: string}>(harness, '')
			.post('/test/oauth2/access-token')
			.body({user_id: owner.userId, scopes: ['personas.read']})
			.execute();

		await createBuilder(harness, `Bearer ${token.token}`)
			.get('/users/@me/personas/groups')
			.expect(HTTP_STATUS.OK)
			.execute();
		await createBuilder(harness, `Bearer ${token.token}`)
			.post('/users/@me/personas/groups')
			.body({name: 'Core'})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
	});

	it('goes with the account, through the steps account deletion runs', async () => {
		const account = await createTestAccount(harness);
		await createGroup(account, 'Core').expect(HTTP_STATUS.CREATED).execute();
		const userId = createUserID(BigInt(account.userId));

		await Promise.all(forkUserDeletionCleanups(userId, getPersonaRepository()));
		expect(await loadPersonaGroups(userId)).toEqual([]);
	});

	it('renames a group without touching its members', async () => {
		const account = await createTestAccount(harness);
		const lyra = await createPersona(account, 'Lyra');
		const group = await createGroup(account, 'Visitors', [lyra.id]).expect(HTTP_STATUS.CREATED).execute();

		const renamed = await createBuilder<PersonaGroupResponse>(harness, account.token)
			.patch(`/users/@me/personas/groups/${group.id}`)
			.body({name: 'Travellers'})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(renamed).toEqual({id: group.id, name: 'Travellers', persona_ids: [lyra.id]});
		expect(await listGroups(account)).toEqual([{id: group.id, name: 'Travellers', persona_ids: [lyra.id]}]);
	});
});
