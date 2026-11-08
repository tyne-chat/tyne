// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import type {
	PersonaChannelStatesResponse,
	PersonaResponse,
	PersonaSettingsResponse,
	PersonaVisibility,
	PublicPersonaListResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

// Many personas changed or deleted in one request (tyne-chat/tyne#542).
describe('persona bulk visibility and delete', () => {
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

	const createPersona = (account: TestAccount, name: string, extra: Record<string, unknown> = {}) =>
		createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({name, ...extra})
			.expect(HTTP_STATUS.CREATED)
			.execute();
	const listOwn = (account: TestAccount) =>
		createBuilder<Array<PersonaResponse>>(harness, account.token).get('/users/@me/personas').execute();
	const visibilities = async (account: TestAccount) =>
		Object.fromEntries((await listOwn(account)).map((p) => [p.name, p.visibility]));
	const setVisibilities = (account: TestAccount, personas: Array<{id: string; visibility: PersonaVisibility}>) =>
		createBuilder<Array<PersonaResponse>>(harness, account.token)
			.patch('/users/@me/personas/visibility')
			.body({personas});
	const bulkDelete = (account: TestAccount, personaIds: Array<string>) =>
		createBuilder(harness, account.token).post('/users/@me/personas/bulk-delete').body({persona_ids: personaIds});

	describe('PATCH /users/@me/personas/visibility', () => {
		it('gives each persona its own visibility in one request, and an undo is one request too', async () => {
			const {owner, members} = await setupTestGuildWithMembers(harness, 1);
			const a = await createPersona(owner, 'Alpha');
			const b = await createPersona(owner, 'Beta');
			const c = await createPersona(owner, 'Gamma', {visibility: 'private'});

			const changed = await setVisibilities(owner, [
				{id: a.id, visibility: 'public'},
				{id: b.id, visibility: 'public'},
				{id: c.id, visibility: 'private'},
			])
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(changed.map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
			expect(await visibilities(owner)).toEqual({Alpha: 'public', Beta: 'public', Gamma: 'private'});
			const seen = await createBuilder<PublicPersonaListResponse>(harness, members[0].token)
				.get(`/users/${owner.userId}/personas`)
				.execute();
			expect(seen.personas.map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);

			await setVisibilities(owner, [
				{id: a.id, visibility: 'unlisted'},
				{id: b.id, visibility: 'unlisted'},
			])
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(await visibilities(owner)).toEqual({Alpha: 'unlisted', Beta: 'unlisted', Gamma: 'private'});
		});

		it("changes nothing when one persona is someone else's or does not exist", async () => {
			const {owner, members} = await setupTestGuildWithMembers(harness, 1);
			const mine = await createPersona(owner, 'Mine');
			const theirs = await createPersona(members[0], 'Theirs');

			await setVisibilities(owner, [
				{id: mine.id, visibility: 'public'},
				{id: theirs.id, visibility: 'public'},
			])
				.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
				.execute();
			await setVisibilities(owner, [
				{id: mine.id, visibility: 'public'},
				{id: '1546500000000000009', visibility: 'public'},
			])
				.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
				.execute();

			expect(await visibilities(owner)).toEqual({Mine: 'unlisted'});
			expect(await visibilities(members[0])).toEqual({Theirs: 'unlisted'});
		});

		it('tells each community once, not once per persona', async () => {
			const {owner} = await setupTestGuildWithMembers(harness, 1);
			const personas = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((name) => createPersona(owner, name)));
			const guildDispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
			const presence = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');

			await setVisibilities(
				owner,
				personas.map((p) => ({id: p.id, visibility: 'public' as const})),
			)
				.expect(HTTP_STATUS.OK)
				.execute();

			const dirty = guildDispatch.mock.calls.filter(([call]) => call.event === 'GUILD_PERSONAS_DIRTY');
			expect(dirty).toHaveLength(1);
			const ownEvents = presence.mock.calls
				.map(([call]) => call)
				.filter((call) => call.userId.toString() === owner.userId.toString())
				.map((call) => call.event);
			expect(ownEvents.filter((event) => event === 'USER_PERSONAS_UPDATE')).toHaveLength(1);
			expect(ownEvents).not.toContain('USER_PERSONA_UPDATE');
		});

		it('needs personas.write for a bearer token', async () => {
			const owner = await createTestAccount(harness);
			const persona = await createPersona(owner, 'Scoped');
			const token = await createBuilder<{token: string}>(harness, '')
				.post('/test/oauth2/access-token')
				.body({user_id: owner.userId, scopes: ['personas.read']})
				.execute();

			await createBuilder(harness, `Bearer ${token.token}`)
				.patch('/users/@me/personas/visibility')
				.body({personas: [{id: persona.id, visibility: 'public'}]})
				.expect(HTTP_STATUS.FORBIDDEN)
				.execute();
		});
	});

	describe('POST /users/@me/personas/bulk-delete', () => {
		it('deletes them as deleting each would: selection and channel selections cleared, tags freed', async () => {
			const {owner, systemChannel} = await setupTestGuildWithMembers(harness, 0);
			const keep = await createPersona(owner, 'Keep');
			const gone = await createPersona(owner, 'Gone', {persona_tags: [{prefix: 'g:'}]});
			const alsoGone = await createPersona(owner, 'Also gone');
			await createBuilder(harness, owner.token)
				.patch('/users/@me/personas/settings')
				.body({active_persona_id: gone.id, is_latched: true})
				.expect(HTTP_STATUS.OK)
				.execute();
			await createBuilder(harness, owner.token)
				.put(`/users/@me/personas/channel-states/${systemChannel.id}`)
				.body({persona_id: alsoGone.id})
				.execute();

			await bulkDelete(owner, [gone.id, alsoGone.id]).expect(HTTP_STATUS.NO_CONTENT).execute();

			expect((await listOwn(owner)).map((p) => p.id)).toEqual([keep.id]);
			const settings = await createBuilder<PersonaSettingsResponse>(harness, owner.token)
				.get('/users/@me/personas/settings')
				.execute();
			expect(settings.active_persona_id).toBeNull();
			const states = await createBuilder<PersonaChannelStatesResponse>(harness, owner.token)
				.get('/users/@me/personas/channel-states')
				.execute();
			expect(states.states).toEqual([]);
			await createPersona(owner, 'Reuses the tag', {persona_tags: [{prefix: 'g:'}]});
		});

		it('deletes nothing when one persona is not a live persona of the caller', async () => {
			const {owner, members} = await setupTestGuildWithMembers(harness, 1);
			const mine = await createPersona(owner, 'Mine');
			const theirs = await createPersona(members[0], 'Theirs');

			await bulkDelete(owner, [mine.id, theirs.id]).expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA').execute();
			await bulkDelete(owner, [mine.id, '1546500000000000009'])
				.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
				.execute();
			await bulkDelete(owner, [mine.id]).expect(HTTP_STATUS.NO_CONTENT).execute();
			await bulkDelete(owner, [mine.id]).expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA').execute();

			expect(await listOwn(owner)).toEqual([]);
			expect((await listOwn(members[0])).map((p) => p.name)).toEqual(['Theirs']);
		});
	});
});
