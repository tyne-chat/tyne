// SPDX-License-Identifier: AGPL-3.0-or-later

import {DELETED_USER_USERNAME, UserFlags} from '@fluxer/constants/src/UserConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {createPersonaID, createUserID} from '../../BrandedTypes';
import {createFriendship} from '../../channel/tests/ChannelTestUtils';
import {createDMChannel, ensureSessionStarted, getMessages} from '../../message/tests/MessageTestUtils';
import {getPersonaRepository, getUserRepository} from '../../middleware/ServiceSingletons';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

describe('Persona Relational Identity & Soft Deletion', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;

	beforeEach(async () => {
		harness = await createApiTestHarness();
		account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
	});

	afterEach(async () => {
		await harness?.shutdown();
	});

	test('soft-deleted persona retains attributes on historical messages but is excluded from active list and quota', async () => {
		const personaRepo = getPersonaRepository();
		const userId = createUserID(BigInt(account.userId));

		// 1. Create a persona and set user display tag
		await createBuilder(harness, account.token)
			.patch('/users/@me/personas/settings')
			.body({
				display_tag_text: 'ArchiveTag',
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		const persona = await createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({
				name: 'Archived Persona',
				avatar_hash: 'a4c41bed',
			})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		expect(await personaRepo.count(userId)).toBe(1);

		// 2. Send a message using this persona
		const sentMessage = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${account.userId}/messages`)
			.body({
				content: 'Message before deletion',
				subprofile: {id: persona.id, name: persona.name},
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(sentMessage.subprofile?.name).toBe('Archived Persona');

		// 3. Soft-delete the persona
		await createBuilder(harness, account.token)
			.delete(`/users/@me/personas/${persona.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		// 4. Verify persona is soft-deleted in DB: deleted_at is set, count is 0, findByUserId excludes it
		const personaId = createPersonaID(BigInt(persona.id));
		const activePersona = await personaRepo.findById(userId, personaId);
		expect(activePersona).toBeNull();

		const softDeletedPersona = await personaRepo.findById(userId, personaId, {includeDeleted: true});
		expect(softDeletedPersona).toBeDefined();
		expect(softDeletedPersona?.isDeleted).toBe(true);
		expect(softDeletedPersona?.deletedAt).toBeInstanceOf(Date);
		expect(await personaRepo.count(userId)).toBe(0);

		const activeList = await createBuilder<Array<PersonaResponse>>(harness, account.token)
			.get('/users/@me/personas')
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(activeList.some((p) => p.id === persona.id)).toBe(false);

		// 5. Retrieve historical message: subprofile attributes are still hydrated
		const messages = await getMessages(harness, account.token, account.userId);
		const fetched = messages.find((m) => m.id === sentMessage.id);
		expect(fetched).toBeDefined();
		expect(fetched?.subprofile).toBeDefined();
		expect(fetched?.subprofile?.id).toBe(persona.id);
		expect(fetched?.subprofile?.name).toBe('Archived Persona');
		expect(fetched?.subprofile?.avatar).toBe('a4c41bed');
		expect(fetched?.subprofile?.display_tag_text).toBe('ArchiveTag');
	});

	test('anonymizes messages and renders tombstone as Deleted Persona when root account is deleted', async () => {
		const observer = await createTestAccount(harness);
		await ensureSessionStarted(harness, observer.token);
		await createFriendship(harness, account, observer);
		const dmChannel = await createDMChannel(harness, account.token, observer.userId);

		const persona = await createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({
				name: 'Ghost Persona',
				avatar_hash: '6405754a',
			})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const sentMessage = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${dmChannel.id}/messages`)
			.body({
				content: 'Message before account deletion',
				subprofile: {id: persona.id, name: persona.name},
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(sentMessage.subprofile?.name).toBe('Ghost Persona');

		// Anonymize the root user account in user repository to simulate account deletion
		const userRepo = getUserRepository();
		const userId = createUserID(BigInt(account.userId));
		await userRepo.patchUpsert(userId, {
			username: DELETED_USER_USERNAME,
			flags: BigInt(UserFlags.DELETED),
		});

		// Retrieve messages: subprofile must render as Deleted Persona with all PII nulled
		const messages = await getMessages(harness, observer.token, dmChannel.id);
		const fetched = messages.find((m) => m.id === sentMessage.id);
		expect(fetched).toBeDefined();
		expect(fetched?.author.username).toBe(DELETED_USER_USERNAME);
		expect(fetched?.subprofile?.name).toBe('Deleted Persona');
		expect(fetched?.subprofile?.avatar).toBeNull();
	});

	test('dynamically updates historical messages when persona attributes change', async () => {
		await createBuilder(harness, account.token)
			.patch('/users/@me/personas/settings')
			.body({
				display_tag_text: 'InitialTag',
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		const persona = await createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({
				name: 'Initial Name',
				avatar_hash: '1217a100',
			})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const sentMessage = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${account.userId}/messages`)
			.body({
				content: 'Dynamic check message',
				subprofile: {id: persona.id, name: persona.name},
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(sentMessage.subprofile?.name).toBe('Initial Name');

		// Update persona attributes and user display tag
		await createBuilder(harness, account.token)
			.patch(`/users/@me/personas/${persona.id}`)
			.body({
				name: 'Evolved Name',
				avatar_hash: 'e501bed0',
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		await createBuilder(harness, account.token)
			.patch('/users/@me/personas/settings')
			.body({
				display_tag_text: 'EvolvedTag',
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		// Retrieve messages again: attributes should reflect update
		const messages = await getMessages(harness, account.token, account.userId);
		const fetched = messages.find((m) => m.id === sentMessage.id);
		expect(fetched).toBeDefined();
		expect(fetched?.subprofile?.name).toBe('Evolved Name');
		expect(fetched?.subprofile?.avatar).toBe('e501bed0');
		expect(fetched?.subprofile?.display_tag_text).toBe('EvolvedTag');
	});
});
