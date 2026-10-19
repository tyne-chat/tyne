// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {PersonaResponse, PublicPersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {createPersonaID, createUserID} from '../../BrandedTypes';
import {ensureSessionStarted, getMessages} from '../../message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';
import {PersonaRepository} from '../PersonaRepository';

// A persona's avatar and banner are hashes of images stored under the account; the routes accept
// nothing else. A row holding anything else (written before the routes checked, or restored from
// a backup) must not hand it on: every response and event is built from the `Persona` model.

describe('Persona images read from storage', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;
	const repo = new PersonaRepository();

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});
	beforeEach(async () => {
		await harness.reset();
		account = await createTestAccount(harness);
	});

	async function personaWithStoredImages(avatar: string, banner: string): Promise<string> {
		const created = await createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({name: 'Fox', visibility: 'public'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		// The repository writes what it is given; only the routes check.
		await repo.update(createUserID(BigInt(account.userId)), createPersonaID(BigInt(created.id)), {
			avatar_hash: avatar,
			banner_hash: banner,
		});
		return created.id;
	}

	it('drops links from the own persona list, the public profile and messages', async () => {
		await ensureSessionStarted(harness, account.token);
		const personaId = await personaWithStoredImages(
			'https://tracker.example/avatar.png',
			'data:image/png;base64,iVBORw0KGgo=',
		);
		const sent = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${account.userId}/messages`)
			.body({content: 'hello', persona_id: personaId})
			.expect(HTTP_STATUS.OK)
			.execute();

		const own = await createBuilder<Array<PersonaResponse>>(harness, account.token)
			.get('/users/@me/personas')
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(own.find((p) => p.id === personaId)).toMatchObject({avatar_hash: null, banner_hash: null});

		const profile = await createBuilder<PublicPersonaResponse>(harness, account.token)
			.get(`/users/${account.userId}/personas/${personaId}`)
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(profile).toMatchObject({avatar_hash: null, banner_hash: null});

		const message = (await getMessages(harness, account.token, account.userId)).find((m) => m.id === sent.id);
		expect(message?.subprofile?.id).toBe(personaId);
		expect(message?.subprofile?.avatar).toBeNull();
	});

	it('passes hashes on', async () => {
		const personaId = await personaWithStoredImages('a_1a2b3c4d', '5e6f7a8b');

		const own = await createBuilder<Array<PersonaResponse>>(harness, account.token)
			.get('/users/@me/personas')
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(own.find((p) => p.id === personaId)).toMatchObject({avatar_hash: 'a_1a2b3c4d', banner_hash: '5e6f7a8b'});
	});
});
