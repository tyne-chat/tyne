// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createUserID} from '@app/api/BrandedTypes';
import {createChannel, setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {upsertOne} from '@app/api/database/CassandraQueryExecution';
import {Db} from '@app/api/database/CassandraTypes';
import {forgetPersonaChannelStatesOfUser} from '@app/api/persona/PersonaChannelStateStore';
import {UserPersonaSettings} from '@app/api/Tables';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import type {
	PersonaChannelState,
	PersonaChannelStatesResponse,
	PersonaResponse,
	PersonaSettingsResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

describe('persona remembered per channel', () => {
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

	const getSettings = (account: TestAccount): Promise<PersonaSettingsResponse> =>
		createBuilder<PersonaSettingsResponse>(harness, account.token).get('/users/@me/personas/settings').execute();

	const listStates = async (account: TestAccount): Promise<Array<PersonaChannelState>> =>
		(
			await createBuilder<PersonaChannelStatesResponse>(harness, account.token)
				.get('/users/@me/personas/channel-states')
				.execute()
		).states;

	const select = (account: TestAccount, channelId: string, personaId: string | null) =>
		createBuilder<PersonaChannelState>(harness, account.token)
			.put(`/users/@me/personas/channel-states/${channelId}`)
			.body({persona_id: personaId});

	describe('the scope setting', () => {
		it('is one persona for every channel until changed, and changing it leaves the rest alone', async () => {
			const account = await createTestAccount(harness);
			expect((await getSettings(account)).active_persona_scope).toBe('global');

			await createBuilder(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({display_tag_text: 'Collective', active_persona_mode: 'last'})
				.execute();
			const changed = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({active_persona_scope: 'channel'})
				.execute();
			expect(changed.active_persona_scope).toBe('channel');
			expect(changed.active_persona_mode).toBe('last');
			expect(changed.display_tag_text).toBe('Collective');

			// A later change to something else keeps the scope.
			await createBuilder(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({display_tag_text: 'Other'})
				.execute();
			expect((await getSettings(account)).active_persona_scope).toBe('channel');
		});

		it('refuses a scope it does not know', async () => {
			const account = await createTestAccount(harness);
			await createBuilder(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({active_persona_scope: 'guild'})
				.expect(HTTP_STATUS.BAD_REQUEST)
				.execute();
		});

		it('reads settings saved before the scope existed as one persona for every channel, and can still save them', async () => {
			const account = await createTestAccount(harness);
			// What such a row looks like: every other field, no scope.
			await upsertOne(
				UserPersonaSettings.patchByPk(
					{user_id: createUserID(BigInt(account.userId))},
					{
						active_persona_mode: Db.set('last'),
						active_persona_id: Db.set(null),
						is_latched: Db.set(false),
						display_tag_text: Db.set('Before'),
						display_tag_icon: Db.set(null),
						updated_at: Db.set(new Date()),
						version: Db.set(1),
					},
				),
			);

			const settings = await getSettings(account);
			expect(settings.active_persona_scope).toBe('global');
			expect(settings.active_persona_mode).toBe('last');
			expect(settings.display_tag_text).toBe('Before');

			const saved = await createBuilder<PersonaSettingsResponse>(harness, account.token)
				.patch('/users/@me/personas/settings')
				.body({display_tag_text: 'After'})
				.execute();
			expect(saved.active_persona_scope).toBe('global');
			expect(saved.display_tag_text).toBe('After');
		});
	});

	describe('the persona selected in a channel', () => {
		it('starts with none, and is set, replaced and cleared per channel', async () => {
			const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
			const other = await createChannel(harness, owner.token, guild.id, 'other');
			const alpha = await createPersona(owner, 'Alpha');
			const beta = await createPersona(owner, 'Beta');
			expect(await listStates(owner)).toEqual([]);

			const set = await select(owner, systemChannel.id, alpha.id).execute();
			expect(set).toEqual({channel_id: systemChannel.id, persona_id: alpha.id});
			await select(owner, other.id, beta.id).execute();
			expect((await listStates(owner)).sort((a, b) => a.channel_id.localeCompare(b.channel_id))).toEqual(
				[
					{channel_id: systemChannel.id, persona_id: alpha.id},
					{channel_id: other.id, persona_id: beta.id},
				].sort((a, b) => a.channel_id.localeCompare(b.channel_id)),
			);

			await select(owner, systemChannel.id, beta.id).execute();
			const cleared = await select(owner, other.id, null).execute();
			expect(cleared).toEqual({channel_id: other.id, persona_id: null});
			expect(await listStates(owner)).toEqual([{channel_id: systemChannel.id, persona_id: beta.id}]);
		});

		it('belongs to the account that set it', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const alpha = await createPersona(owner, 'Alpha');
			await select(owner, systemChannel.id, alpha.id).execute();

			expect(await listStates(members[0])).toEqual([]);
		});

		it('tells the account itself and nobody else', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const alpha = await createPersona(owner, 'Alpha');
			const presence = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');
			const guildDispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');

			await select(owner, systemChannel.id, alpha.id).execute();

			const sent = presence.mock.calls
				.map(([call]) => call)
				.filter((call) => call.event === 'USER_PERSONA_CHANNEL_STATE_UPDATE');
			expect(sent).toHaveLength(1);
			expect(sent[0].userId.toString()).toBe(owner.userId.toString());
			expect(sent[0].data).toEqual({channel_id: systemChannel.id, persona_id: alpha.id});
			expect(presence.mock.calls.some(([call]) => call.userId.toString() === members[0].userId.toString())).toBe(false);
			expect(guildDispatch).not.toHaveBeenCalled();
		});

		it('refuses a persona of another account and a persona that does not exist', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const theirs = await createPersona(members[0], 'Theirs');

			await select(owner, systemChannel.id, theirs.id).expect(HTTP_STATUS.NOT_FOUND).execute();
			await select(owner, systemChannel.id, '999999999999999999').expect(HTTP_STATUS.NOT_FOUND).execute();
			expect(await listStates(owner)).toEqual([]);
		});

		it('refuses a channel the account cannot see', async () => {
			const {systemChannel} = await setupTestGuildWithMembers(harness, 0);
			const outsider = await createTestAccount(harness);
			const persona = await createPersona(outsider, 'Outsider');

			const response = await select(outsider, systemChannel.id, persona.id).executeRaw();
			expect([HTTP_STATUS.FORBIDDEN, HTTP_STATUS.NOT_FOUND]).toContain(response.response.status);
			expect(await listStates(outsider)).toEqual([]);
		});

		it('goes back to the account in every channel when the persona is deleted', async () => {
			const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
			const other = await createChannel(harness, owner.token, guild.id, 'other');
			const alpha = await createPersona(owner, 'Alpha');
			const beta = await createPersona(owner, 'Beta');
			await select(owner, systemChannel.id, alpha.id).execute();
			await select(owner, other.id, beta.id).execute();
			const presence = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');

			await createBuilder(harness, owner.token)
				.delete(`/users/@me/personas/${alpha.id}`)
				.expect(HTTP_STATUS.NO_CONTENT)
				.execute();

			expect(await listStates(owner)).toEqual([{channel_id: other.id, persona_id: beta.id}]);
			const sent = presence.mock.calls
				.map(([call]) => call)
				.filter((call) => call.event === 'USER_PERSONA_CHANNEL_STATE_UPDATE');
			expect(sent.map((call) => call.data)).toEqual([{channel_id: systemChannel.id, persona_id: null}]);
		});

		it('is removed with the account', async () => {
			const {owner, systemChannel} = await setupTestGuildWithMembers(harness, 0);
			const alpha = await createPersona(owner, 'Alpha');
			await select(owner, systemChannel.id, alpha.id).execute();

			await forgetPersonaChannelStatesOfUser(createUserID(BigInt(owner.userId)));

			expect(await listStates(owner)).toEqual([]);
		});
	});
});
