// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import type {
	ChannelPersonaMentionItem,
	PersonaResponse,
	PersonaVisibility,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	PersonaImportAction,
	PersonaImportApplyResponse,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import type {PersonaMentionableBy} from '@fluxer/schema/src/domains/persona/PersonaMentionableBy';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

// Who gets a persona in mention and search suggestions (tyne-chat/tyne#652).
describe('persona mention setting', () => {
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
	const updatePersona = (account: TestAccount, id: string, body: Record<string, unknown>) =>
		createBuilder<PersonaResponse>(harness, account.token)
			.patch(`/users/@me/personas/${id}`)
			.body(body)
			.expect(HTTP_STATUS.OK)
			.execute();
	const suggested = async (account: TestAccount, channelId: string) =>
		createBuilder<Array<ChannelPersonaMentionItem>>(harness, account.token)
			.get(`/channels/${channelId}/persona-mentions`)
			.expect(HTTP_STATUS.OK)
			.execute();
	const suggestedNames = async (account: TestAccount, channelId: string) =>
		(await suggested(account, channelId)).map((p) => p.name).sort();
	const setMentionableBy = (
		account: TestAccount,
		personas: Array<{id: string; mentionable_by: PersonaMentionableBy | null}>,
	) =>
		createBuilder<Array<PersonaResponse>>(harness, account.token)
			.patch('/users/@me/personas/mentions')
			.body({personas});
	const storedSettings = async (account: TestAccount) =>
		Object.fromEntries(
			(await createBuilder<Array<PersonaResponse>>(harness, account.token).get('/users/@me/personas').execute()).map(
				(p) => [p.name, p.mentionable_by],
			),
		);

	describe('suggestions', () => {
		it('offers another account only personas for everyone, and the owner all but those for nobody', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const cases: Array<[string, PersonaVisibility, PersonaMentionableBy | null]> = [
				['Untouched unlisted', 'unlisted', null],
				['Untouched private', 'private', null],
				['Unlisted everyone', 'unlisted', 'everyone'],
				['Unlisted self', 'unlisted', 'self'],
				['Unlisted nobody', 'unlisted', 'nobody'],
				['Public nobody', 'public', 'nobody'],
				['Private everyone', 'private', 'everyone'],
			];
			for (const [name, visibility, mentionable_by] of cases) {
				await createPersona(owner, name, {visibility, mentionable_by});
			}

			expect(await suggestedNames(members[0], systemChannel.id)).toEqual(
				['Private everyone', 'Unlisted everyone', 'Untouched unlisted'].sort(),
			);
			expect(await suggestedNames(owner, systemChannel.id)).toEqual(
				['Private everyone', 'Unlisted everyone', 'Unlisted self', 'Untouched private', 'Untouched unlisted'].sort(),
			);
		});

		it("keeps a private persona's profile from others when it is offered to everyone", async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			await createPersona(owner, 'Quiet', {
				visibility: 'private',
				mentionable_by: 'everyone',
				bio: 'A bio',
				pronouns: 'they/them',
			});

			const [seenByMember] = await suggested(members[0], systemChannel.id);
			expect(seenByMember).toMatchObject({name: 'Quiet', bio: null, pronouns: null, banner_hash: null});
			const [seenByOwner] = await suggested(owner, systemChannel.id);
			expect(seenByOwner).toMatchObject({name: 'Quiet', bio: 'A bio', pronouns: 'they/them'});
		});
	});

	describe('stored value', () => {
		it('stays null until chosen, so making an untouched persona private hides it from others', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const untouched = await createPersona(owner, 'Untouched');
			const chosen = await createPersona(owner, 'Chosen', {mentionable_by: 'everyone'});
			expect(untouched.mentionable_by).toBeNull();
			expect(chosen.mentionable_by).toBe('everyone');

			await updatePersona(owner, untouched.id, {visibility: 'private'});
			await updatePersona(owner, chosen.id, {visibility: 'private'});

			expect(await suggestedNames(members[0], systemChannel.id)).toEqual(['Chosen']);
			expect(await storedSettings(owner)).toEqual({Untouched: null, Chosen: 'everyone'});
		});

		it('keeps the stored value when an update leaves it out, and null follows visibility again', async () => {
			const owner = await createTestAccount(harness);
			const persona = await createPersona(owner, 'Lyra', {mentionable_by: 'nobody'});

			const renamed = await updatePersona(owner, persona.id, {name: 'Lyra (copy)'});
			expect(renamed.mentionable_by).toBe('nobody');
			const reset = await updatePersona(owner, persona.id, {mentionable_by: null});
			expect(reset.mentionable_by).toBeNull();
		});

		it('does not tell every community about a new persona nobody else gets', async () => {
			const {owner} = await setupTestGuildWithMembers(harness, 1);
			const guildDispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
			const dirtyCount = () =>
				guildDispatch.mock.calls.filter(([call]) => call.event === 'GUILD_PERSONAS_DIRTY').length;

			await createPersona(owner, 'Clone', {mentionable_by: 'nobody'});
			await createPersona(owner, 'Mine only', {mentionable_by: 'self'});
			await createPersona(owner, 'Untouched private', {visibility: 'private'});
			expect(dirtyCount()).toBe(0);

			await createPersona(owner, 'Private everyone', {visibility: 'private', mentionable_by: 'everyone'});
			expect(dirtyCount()).toBe(1);
			await createPersona(owner, 'Untouched unlisted');
			expect(dirtyCount()).toBe(2);
		});
	});

	describe('import', () => {
		const apply = (account: TestAccount, source: 'tyne' | 'pluralkit', actions: Array<PersonaImportAction>) =>
			createBuilder<PersonaImportApplyResponse>(harness, account.token)
				.post('/users/@me/personas/import/apply')
				.body({source, actions})
				.expect(HTTP_STATUS.OK)
				.execute();

		it("brings a Tyne export's setting back, and never changes an existing persona's", async () => {
			const owner = await createTestAccount(harness);
			const existing = await createPersona(owner, 'Wren', {mentionable_by: 'self', external_uuid: 'wwwww'});

			await apply(owner, 'tyne', [
				{action: 'add', item: {name: 'Clone', mentionable_by: 'nobody', external_uuid: 'ccccc'}},
				{action: 'add', item: {name: 'Plain', external_uuid: 'ppppp'}},
				{
					action: 'use_file',
					persona_id: existing.id,
					item: {name: 'Wren', mentionable_by: 'everyone', external_uuid: 'wwwww'},
				},
			]);

			expect(await storedSettings(owner)).toEqual({Clone: 'nobody', Plain: null, Wren: 'self'});
		});

		it('takes no setting from a PluralKit file, which has none', async () => {
			const owner = await createTestAccount(harness);
			await apply(owner, 'pluralkit', [
				{action: 'add', item: {name: 'Member', mentionable_by: 'nobody', external_uuid: 'mmmmm'}},
			]);
			expect(await storedSettings(owner)).toEqual({Member: null});
		});
	});

	describe('PATCH /users/@me/personas/mentions', () => {
		it('gives each persona its own setting in one request, and an undo restores null', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const a = await createPersona(owner, 'Alpha');
			const b = await createPersona(owner, 'Beta');
			const c = await createPersona(owner, 'Gamma', {mentionable_by: 'self'});

			const changed = await setMentionableBy(owner, [
				{id: a.id, mentionable_by: 'nobody'},
				{id: b.id, mentionable_by: 'self'},
				{id: c.id, mentionable_by: 'self'},
			])
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(changed.map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
			expect(await storedSettings(owner)).toEqual({Alpha: 'nobody', Beta: 'self', Gamma: 'self'});
			expect(await suggestedNames(members[0], systemChannel.id)).toEqual([]);
			expect(await suggestedNames(owner, systemChannel.id)).toEqual(['Beta', 'Gamma']);

			await setMentionableBy(owner, [
				{id: a.id, mentionable_by: null},
				{id: b.id, mentionable_by: null},
			])
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(await storedSettings(owner)).toEqual({Alpha: null, Beta: null, Gamma: 'self'});
		});

		it("changes nothing when one persona is someone else's", async () => {
			const {owner, members} = await setupTestGuildWithMembers(harness, 1);
			const mine = await createPersona(owner, 'Mine');
			const theirs = await createPersona(members[0], 'Theirs');

			await setMentionableBy(owner, [
				{id: mine.id, mentionable_by: 'nobody'},
				{id: theirs.id, mentionable_by: 'nobody'},
			])
				.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
				.execute();

			expect(await storedSettings(owner)).toEqual({Mine: null});
			expect(await storedSettings(members[0])).toEqual({Theirs: null});
		});

		it('tells each community once, not once per persona', async () => {
			const {owner} = await setupTestGuildWithMembers(harness, 1);
			const personas = await Promise.all(['A', 'B', 'C'].map((name) => createPersona(owner, name)));
			const guildDispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');

			await setMentionableBy(
				owner,
				personas.map((p) => ({id: p.id, mentionable_by: 'nobody' as const})),
			)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(guildDispatch.mock.calls.filter(([call]) => call.event === 'GUILD_PERSONAS_DIRTY')).toHaveLength(1);
		});

		it('needs personas.write for a bearer token', async () => {
			const owner = await createTestAccount(harness);
			const persona = await createPersona(owner, 'Scoped');
			const token = await createBuilder<{token: string}>(harness, '')
				.post('/test/oauth2/access-token')
				.body({user_id: owner.userId, scopes: ['personas.read']})
				.execute();

			await createBuilder(harness, `Bearer ${token.token}`)
				.patch('/users/@me/personas/mentions')
				.body({personas: [{id: persona.id, mentionable_by: 'nobody'}]})
				.expect(HTTP_STATUS.FORBIDDEN)
				.execute();
		});
	});
});
