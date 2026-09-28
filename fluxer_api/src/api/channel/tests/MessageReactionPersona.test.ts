// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {sendChannelMessage, setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import type {ReactionUserItemResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const EMOJI = encodeURIComponent('🦊');

interface ReactionUsersPage {
	items: Array<ReactionUserItemResponse>;
	has_more: boolean;
	next_after: string | null;
}

describe('Message persona reactions', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	it('allows a user to react as a persona, lists persona subprofiles, and supports co-existing root reactions', async () => {
		const {members, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [author, reactor] = members as [TestAccount, TestAccount];

		// 1. Post a test message
		const message = await sendChannelMessage(harness, author.token, systemChannel.id, 'Reaction persona test');

		// 2. Reactor creates a persona
		const persona = await createBuilder<PersonaResponse>(harness, reactor.token)
			.post('/users/@me/personas')
			.body({
				name: 'Kitsune',
				pronouns: 'kitsune/they',
				color: 0xff6600,
			})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		expect(persona.id).toBeDefined();

		// 3. React as the persona
		await createBuilder(harness, reactor.token)
			.put(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/@me`)
			.body({persona_id: persona.id})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		// 4. List reaction users and verify persona_id & subprofile
		let page = await createBuilder<ReactionUsersPage>(harness, reactor.token)
			.get(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/users`)
			.execute();

		expect(page.items).toHaveLength(1);
		expect(page.items[0].id).toBe(reactor.userId);
		expect(page.items[0].persona_id).toBe(persona.id);
		expect(page.items[0].subprofile).toBeDefined();
		expect(page.items[0].subprofile?.id).toBe(persona.id);
		expect(page.items[0].subprofile?.name).toBe('Kitsune');
		expect(page.items[0].subprofile?.pronouns).toBe('kitsune/they');

		// 5. Reactor also reacts as root account with the same emoji
		await createBuilder(harness, reactor.token)
			.put(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/@me`)
			.body(null)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		// Both root and persona reactions should appear
		page = await createBuilder<ReactionUsersPage>(harness, reactor.token)
			.get(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/users`)
			.execute();

		expect(page.items).toHaveLength(2);
		const personaItem = page.items.find((item) => item.persona_id === persona.id);
		const rootItem = page.items.find((item) => !item.persona_id);
		expect(personaItem).toBeDefined();
		expect(rootItem).toBeDefined();
		expect(rootItem?.subprofile).toBeNull();

		// 6. Remove persona reaction
		await createBuilder(harness, reactor.token)
			.delete(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/@me?persona_id=${persona.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		// Root reaction should remain
		page = await createBuilder<ReactionUsersPage>(harness, reactor.token)
			.get(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/users`)
			.execute();

		expect(page.items).toHaveLength(1);
		expect(page.items[0].persona_id).toBeNull();

		// 7. Remove root reaction
		await createBuilder(harness, reactor.token)
			.delete(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/@me`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		page = await createBuilder<ReactionUsersPage>(harness, reactor.token)
			.get(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/users`)
			.execute();

		expect(page.items).toHaveLength(0);
	});

	it('rejects reacting with a persona that does not belong to the user', async () => {
		const {members, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [author, reactor] = members as [TestAccount, TestAccount];

		const message = await sendChannelMessage(harness, author.token, systemChannel.id, 'Test invalid persona reaction');

		// Author creates a persona
		const authorPersona = await createBuilder<PersonaResponse>(harness, author.token)
			.post('/users/@me/personas')
			.body({name: 'Author Persona'})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		// Reactor tries to react using Author's persona ID -> must reject with 404 UNKNOWN_PERSONA
		await createBuilder(harness, reactor.token)
			.put(`/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}/@me`)
			.body({persona_id: authorPersona.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
	});
});
