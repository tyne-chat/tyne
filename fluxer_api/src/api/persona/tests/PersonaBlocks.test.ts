// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createUserID} from '@app/api/BrandedTypes';
import {getPersonaRepository} from '@app/api/middleware/ForkServiceSingletons';
import {loadPersonaBlocks} from '@app/api/persona/PersonaBlockStore';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {forkUserDeletionCleanups} from '@app/api/user/services/ForkUserDeletionCleanups';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaBlockListResponse} from '@fluxer/schema/src/domains/persona/PersonaBlockSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

describe('blocked personas (tyne-chat/tyne#921)', () => {
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

	const block = (account: TestAccount, userId: string, personaId: string) =>
		createBuilder<PersonaBlockListResponse>(harness, account.token).put(
			`/users/@me/personas/blocks/${userId}/${personaId}`,
		);

	const unblock = (account: TestAccount, userId: string, personaId: string) =>
		createBuilder<PersonaBlockListResponse>(harness, account.token).delete(
			`/users/@me/personas/blocks/${userId}/${personaId}`,
		);

	const listBlocks = (account: TestAccount): Promise<PersonaBlockListResponse> =>
		createBuilder<PersonaBlockListResponse>(harness, account.token).get('/users/@me/personas/blocks').execute();

	it('blocks and unblocks another account’s persona, and lists the blocks in order', async () => {
		const viewer = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const lyra = await createPersona(other, 'Lyra');
		const vega = await createPersona(other, 'Vega');

		expect(await listBlocks(viewer)).toEqual([]);
		expect(await block(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute()).toEqual([
			{user_id: other.userId, persona_id: lyra.id},
		]);
		await block(viewer, other.userId, vega.id).expect(HTTP_STATUS.OK).execute();
		expect(await listBlocks(viewer)).toEqual([
			{user_id: other.userId, persona_id: lyra.id},
			{user_id: other.userId, persona_id: vega.id},
		]);

		expect(await unblock(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute()).toEqual([
			{user_id: other.userId, persona_id: vega.id},
		]);
		expect(await listBlocks(viewer)).toEqual([{user_id: other.userId, persona_id: vega.id}]);
	});

	it('takes a block or an unblock twice without changing anything', async () => {
		const viewer = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const lyra = await createPersona(other, 'Lyra');

		await block(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();
		await block(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();
		expect(await listBlocks(viewer)).toEqual([{user_id: other.userId, persona_id: lyra.id}]);

		await unblock(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();
		expect(await unblock(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute()).toEqual([]);
	});

	it('keeps the lists of different accounts apart', async () => {
		const viewer = await createTestAccount(harness);
		const bystander = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const lyra = await createPersona(other, 'Lyra');

		await block(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();
		expect(await listBlocks(bystander)).toEqual([]);
		expect(await listBlocks(other)).toEqual([]);
	});

	it('refuses one’s own persona and a persona that does not exist', async () => {
		const viewer = await createTestAccount(harness);
		const own = await createPersona(viewer, 'Own');
		const other = await createTestAccount(harness);

		await block(viewer, viewer.userId, own.id)
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.CANNOT_BLOCK_OWN_PERSONA)
			.execute();
		await block(viewer, other.userId, '123456789012345678')
			.expect(HTTP_STATUS.NOT_FOUND, APIErrorCodes.UNKNOWN_PERSONA)
			.execute();
		expect(await listBlocks(viewer)).toEqual([]);
	});

	it('blocks a deleted persona, whose old messages still show it', async () => {
		const viewer = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const lyra = await createPersona(other, 'Lyra');
		await createBuilder(harness, other.token)
			.delete(`/users/@me/personas/${lyra.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		await block(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();
		expect(await listBlocks(viewer)).toEqual([{user_id: other.userId, persona_id: lyra.id}]);
	});

	it('sends the whole list to the blocking account’s own sessions only', async () => {
		const viewer = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const lyra = await createPersona(other, 'Lyra');
		const guildDispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
		const presence = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');

		await block(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();
		await unblock(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();

		const events = presence.mock.calls
			.map(([call]) => call)
			.filter((call) => call.event === 'USER_PERSONA_BLOCKS_UPDATE');
		expect(events).toHaveLength(2);
		expect(events.every((call) => call.userId.toString() === viewer.userId.toString())).toBe(true);
		expect(events[0].data).toEqual({blocks: [{user_id: other.userId, persona_id: lyra.id}]});
		expect(events[1].data).toEqual({blocks: []});
		expect(guildDispatch).not.toHaveBeenCalled();
	});

	it('needs personas.write for a bearer token to block', async () => {
		const viewer = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const lyra = await createPersona(other, 'Lyra');
		const token = await createBuilder<{token: string}>(harness, '')
			.post('/test/oauth2/access-token')
			.body({user_id: viewer.userId, scopes: ['personas.read']})
			.execute();

		await createBuilder(harness, `Bearer ${token.token}`)
			.get('/users/@me/personas/blocks')
			.expect(HTTP_STATUS.OK)
			.execute();
		await createBuilder(harness, `Bearer ${token.token}`)
			.put(`/users/@me/personas/blocks/${other.userId}/${lyra.id}`)
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
	});

	it('goes with the account, through the steps account deletion runs', async () => {
		const viewer = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const lyra = await createPersona(other, 'Lyra');
		await block(viewer, other.userId, lyra.id).expect(HTTP_STATUS.OK).execute();
		const userId = createUserID(BigInt(viewer.userId));

		await Promise.all(forkUserDeletionCleanups(userId, getPersonaRepository()));
		expect(await loadPersonaBlocks(userId)).toEqual([]);
	});
});
