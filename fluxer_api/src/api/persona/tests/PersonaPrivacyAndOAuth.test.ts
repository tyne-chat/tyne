// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaResponse, PublicPersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {Config} from '../../Config';
import {createFriendship} from '../../channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

interface OAuth2TokenResponse {
	token: string;
	user_id: string;
	scopes: Array<string>;
	application_id: string;
}

async function createOAuth2Token(
	harness: ApiTestHarness,
	userId: string,
	scopes: Array<string>,
): Promise<OAuth2TokenResponse> {
	return createBuilder<OAuth2TokenResponse>(harness, '')
		.post('/test/oauth2/access-token')
		.body({
			user_id: userId,
			scopes,
		})
		.execute();
}

describe('Persona Privacy and OAuth2 Scope Enforcement', () => {
	let harness: ApiTestHarness;
	let userA: TestAccount;
	let userB: TestAccount;
	let userC: TestAccount;

	beforeEach(async () => {
		harness = await createApiTestHarness();
		userA = await createTestAccount(harness);
		userB = await createTestAccount(harness);
		userC = await createTestAccount(harness);
	});

	afterEach(() => {
		Config.dev.validateResponses = true;
	});

	describe('OAuth2 Bearer Scope Enforcement', () => {
		test('GET /users/@me/personas requires personas.read scope for bearer tokens', async () => {
			const tokenWithoutScope = await createOAuth2Token(harness, userA.userId, ['identify']);
			await createBuilder(harness, `Bearer ${tokenWithoutScope.token}`)
				.get('/users/@me/personas')
				.expect(HTTP_STATUS.FORBIDDEN)
				.execute();

			const tokenWithScope = await createOAuth2Token(harness, userA.userId, ['personas.read']);
			const res = await createBuilder<Array<PersonaResponse>>(harness, `Bearer ${tokenWithScope.token}`)
				.get('/users/@me/personas')
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(Array.isArray(res)).toBe(true);
		});

		test('POST /users/@me/personas requires personas.write scope for bearer tokens', async () => {
			const tokenWithoutScope = await createOAuth2Token(harness, userA.userId, ['personas.read']);
			await createBuilder(harness, `Bearer ${tokenWithoutScope.token}`)
				.post('/users/@me/personas')
				.body({name: 'OAuth Created'})
				.expect(HTTP_STATUS.FORBIDDEN)
				.execute();

			const tokenWithScope = await createOAuth2Token(harness, userA.userId, ['personas.write']);
			const created = await createBuilder<PersonaResponse>(harness, `Bearer ${tokenWithScope.token}`)
				.post('/users/@me/personas')
				.body({name: 'OAuth Created'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			expect(created.name).toBe('OAuth Created');
		});

		test('Standard user session tokens bypass OAuth2 scope restrictions', async () => {
			const res = await createBuilder<Array<PersonaResponse>>(harness, userA.token)
				.get('/users/@me/personas')
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(Array.isArray(res)).toBe(true);
		});
	});

	describe('Mutual Context Verification', () => {
		test('User with NO mutual guilds/friendship cannot view public personas or cards', async () => {
			const created = await createBuilder<PersonaResponse>(harness, userA.token)
				.post('/users/@me/personas')
				.body({name: 'Secret Persona', visibility: 'public', bio: 'Bio details'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			// User C shares no friendship or guild with User A
			await createBuilder(harness, userC.token)
				.get(`/users/${userA.userId}/personas`)
				.expect(HTTP_STATUS.FORBIDDEN)
				.execute();

			await createBuilder(harness, userC.token)
				.get(`/users/${userA.userId}/personas/${created.id}`)
				.expect(HTTP_STATUS.FORBIDDEN)
				.execute();
		});

		test('User WITH mutual friendship can access persona endpoints', async () => {
			await createFriendship(harness, userA, userB);

			const created = await createBuilder<PersonaResponse>(harness, userA.token)
				.post('/users/@me/personas')
				.body({name: 'Shared Persona', visibility: 'public', bio: 'Hello friend'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			const list = await createBuilder<Array<PublicPersonaResponse>>(harness, userB.token)
				.get(`/users/${userA.userId}/personas`)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(list).toHaveLength(1);
			expect(list[0]!.name).toBe('Shared Persona');

			const card = await createBuilder<PublicPersonaResponse>(harness, userB.token)
				.get(`/users/${userA.userId}/personas/${created.id}`)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(card.bio).toBe('Hello friend');
		});
	});

	describe('3-Tier Visibility Matrix (public | unlisted | private)', () => {
		test('enforces visibility rules between friend viewer and owner', async () => {
			await createFriendship(harness, userA, userB);

			// User A creates 3 personas
			const pPublic = await createBuilder<PersonaResponse>(harness, userA.token)
				.post('/users/@me/personas')
				.body({name: 'Public One', visibility: 'public', bio: 'Public Bio'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			const pUnlisted = await createBuilder<PersonaResponse>(harness, userA.token)
				.post('/users/@me/personas')
				.body({name: 'Unlisted One', visibility: 'unlisted', bio: 'Unlisted Bio'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			const pPrivate = await createBuilder<PersonaResponse>(harness, userA.token)
				.post('/users/@me/personas')
				.body({name: 'Private One', visibility: 'private', bio: 'Private Bio'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			// 1. Directory Listing (GET /users/:id/personas): Only public personas appear
			const directory = await createBuilder<Array<PublicPersonaResponse>>(harness, userB.token)
				.get(`/users/${userA.userId}/personas`)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(directory).toHaveLength(1);
			expect(directory[0]!.id).toBe(pPublic.id);
			expect(directory[0]!.name).toBe('Public One');

			// 2. Direct Query for Public: Returns 200
			const publicCard = await createBuilder<PublicPersonaResponse>(harness, userB.token)
				.get(`/users/${userA.userId}/personas/${pPublic.id}`)
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(publicCard.bio).toBe('Public Bio');

			// 3. Direct Query for Unlisted (Chat message click): Returns 200
			const unlistedCard = await createBuilder<PublicPersonaResponse>(harness, userB.token)
				.get(`/users/${userA.userId}/personas/${pUnlisted.id}`)
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(unlistedCard.bio).toBe('Unlisted Bio');

			// 4. Direct Query for Private by Friend: Returns 404
			await createBuilder(harness, userB.token)
				.get(`/users/${userA.userId}/personas/${pPrivate.id}`)
				.expect(HTTP_STATUS.NOT_FOUND)
				.execute();

			// 5. Direct Query for Private by Owner: Returns 200
			const ownerSelf = await createBuilder<PersonaResponse>(harness, userA.token)
				.get(`/users/@me/personas/${pPrivate.id}`)
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(ownerSelf.bio).toBe('Private Bio');
		});
	});
});
