// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: an import is written whole or not at all, and "replace" deletes the old personas in the same
// write, so a refused or failed import leaves the account's personas as they were (tyne-chat/tyne#359).

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {InMemoryCassandraQueryExecutor} from '@app/api/test/InMemoryCassandraQueryExecutor';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import type {
	PersonaChannelState,
	PersonaChannelStatesResponse,
	PersonaImportItem,
	PersonaResponse,
	PersonaSettingsResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

describe('persona import, all or nothing', () => {
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

	const createPersona = (account: TestAccount, body: {name: string; persona_tags?: Array<{prefix: string}>}) =>
		createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body(body)
			.expect(HTTP_STATUS.CREATED)
			.execute();

	const listPersonas = (account: TestAccount) =>
		createBuilder<Array<PersonaResponse>>(harness, account.token).get('/users/@me/personas').execute();

	const getSettings = (account: TestAccount) =>
		createBuilder<PersonaSettingsResponse>(harness, account.token).get('/users/@me/personas/settings').execute();

	const listStates = async (account: TestAccount): Promise<Array<PersonaChannelState>> =>
		(
			await createBuilder<PersonaChannelStatesResponse>(harness, account.token)
				.get('/users/@me/personas/channel-states')
				.execute()
		).states;

	const importAs = (account: TestAccount, items: Array<PersonaImportItem>, replace: boolean) =>
		createBuilder<Array<PersonaResponse>>(harness, account.token)
			.post(`/users/@me/personas/import${replace ? '?replace=true' : ''}`)
			.body(items);

	/** An account with two personas, the first selected for every channel and in its community's channel. */
	async function accountWithSelectedPersonas() {
		const {owner, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		const alpha = await createPersona(owner, {name: 'Old Alpha', persona_tags: [{prefix: 'a:'}]});
		const beta = await createPersona(owner, {name: 'Old Beta', persona_tags: [{prefix: 'b:'}]});
		await createBuilder(harness, owner.token)
			.patch('/users/@me/personas/settings')
			.body({active_persona_id: alpha.id, is_latched: true})
			.execute();
		await createBuilder(harness, owner.token)
			.put(`/users/@me/personas/channel-states/${systemChannel.id}`)
			.body({persona_id: alpha.id})
			.execute();
		return {owner, systemChannel, alpha, beta};
	}

	async function snapshot(account: TestAccount) {
		return {
			personas: (await listPersonas(account)).map((p) => [p.id, p.name]).sort(),
			settings: await getSettings(account),
			states: await listStates(account),
		};
	}

	describe('replace', () => {
		it('swaps the personas in one write, frees their tags and clears the selections that named them', async () => {
			const {owner, systemChannel} = await accountWithSelectedPersonas();
			const presence = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');
			const batch = vi.spyOn(InMemoryCassandraQueryExecutor.prototype, 'executeBatch');

			// The same tags as the old personas: a re-imported system usually has them.
			const imported = await importAs(
				owner,
				[
					{name: 'Alpha', persona_tags: [{prefix: 'a:'}]},
					{name: 'Beta', persona_tags: [{prefix: 'b:'}]},
				],
				true,
			)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(imported.map((p) => p.name)).toEqual(['Alpha', 'Beta']);
			expect((await listPersonas(owner)).map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
			const settings = await getSettings(owner);
			expect(settings.active_persona_id).toBeNull();
			expect(settings.is_latched).toBe(false);
			expect(await listStates(owner)).toEqual([]);

			const personaBatches = batch.mock.calls.filter(([queries]) =>
				queries.some((query) => query.meta?.table.name === 'personas'),
			);
			expect(personaBatches).toHaveLength(1);
			expect(personaBatches[0]?.[1]).not.toBe(false);

			const events = presence.mock.calls.map(([call]) => call.event);
			expect(events.filter((event) => event === 'USER_PERSONAS_UPDATE')).toHaveLength(1);
			expect(events).not.toContain('USER_PERSONA_DELETE');
			expect(
				presence.mock.calls
					.map(([call]) => call)
					.filter((call) => call.event === 'USER_PERSONA_CHANNEL_STATE_UPDATE')
					.map((call) => call.data),
			).toEqual([{channel_id: systemChannel.id, persona_id: null}]);
		});

		it('keeps every persona and selection when the file is refused', async () => {
			const {owner} = await accountWithSelectedPersonas();
			const before = await snapshot(owner);

			// Two members with one tag: the server refuses the whole file.
			await importAs(
				owner,
				[
					{name: 'New One', persona_tags: [{prefix: 'x:'}]},
					{name: 'New Two', persona_tags: [{prefix: 'x:'}]},
				],
				true,
			)
				.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.DUPLICATE_PERSONA_TAG)
				.execute();

			expect(await snapshot(owner)).toEqual(before);
		});

		it('keeps every persona and selection when writing the import fails', async () => {
			const {owner} = await accountWithSelectedPersonas();
			const before = await snapshot(owner);
			// The in-memory database does not roll back, so fail the batch before it writes anything:
			// what is left unchanged then is everything the import writes outside that batch.
			const original = InMemoryCassandraQueryExecutor.prototype.executeBatch;
			vi.spyOn(InMemoryCassandraQueryExecutor.prototype, 'executeBatch').mockImplementation(async function (
				this: InMemoryCassandraQueryExecutor,
				queries,
				atomic,
			) {
				if (queries.some((query) => query.meta?.table.name === 'personas')) throw new Error('database unavailable');
				return original.call(this, queries, atomic);
			});

			await importAs(owner, [{name: 'Alpha'}], true)
				.expect(HTTP_STATUS.INTERNAL_SERVER_ERROR)
				.execute();

			vi.restoreAllMocks();
			expect(await snapshot(owner)).toEqual(before);
		});
	});

	describe('append', () => {
		it('writes nothing from a file that would go over the persona cap', async () => {
			const {owner} = await setupTestGuildWithMembers(harness, 0);
			const filler = Array.from({length: 249}, (_, i) => ({name: `Persona ${i}`}));
			await importAs(owner, filler, false).expect(HTTP_STATUS.OK).execute();

			await importAs(owner, [{name: 'Fits'}, {name: 'One too many'}], false)
				.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.PERSONA_LIMIT_REACHED)
				.execute();

			const names = (await listPersonas(owner)).map((p) => p.name);
			expect(names).toHaveLength(249);
			expect(names).not.toContain('Fits');
		});
	});
});
