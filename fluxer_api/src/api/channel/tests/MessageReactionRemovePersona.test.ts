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
}

// tyne-chat/tyne#123 (audit M2-5): a removal without persona_id is the account's own reaction only.
describe('Removing a reaction without persona_id', () => {
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

	async function reactAsAccountAndPersona() {
		const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const [reactor] = members as [TestAccount];
		const message = await sendChannelMessage(harness, owner.token, systemChannel.id, 'Reaction removal test');
		const persona = await createBuilder<PersonaResponse>(harness, reactor.token)
			.post('/users/@me/personas')
			.body({name: 'Kitsune'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const reactionPath = `/channels/${systemChannel.id}/messages/${message.id}/reactions/${EMOJI}`;
		await createBuilder(harness, reactor.token)
			.put(`${reactionPath}/@me`)
			.body({persona_id: persona.id})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		await createBuilder(harness, reactor.token)
			.put(`${reactionPath}/@me`)
			.body(null)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		const listReactors = async () =>
			(await createBuilder<ReactionUsersPage>(harness, reactor.token).get(`${reactionPath}/users`).execute()).items.map(
				(item) => ({id: item.id, persona_id: item.persona_id ?? null}),
			);
		expect(await listReactors()).toHaveLength(2);
		return {owner, reactor, persona, reactionPath, listReactors};
	}

	it("keeps the user's persona reactions when removing their own", async () => {
		const {reactor, persona, reactionPath, listReactors} = await reactAsAccountAndPersona();

		await createBuilder(harness, reactor.token).delete(`${reactionPath}/@me`).expect(HTTP_STATUS.NO_CONTENT).execute();

		expect(await listReactors()).toEqual([{id: reactor.userId, persona_id: persona.id}]);
	});

	it("keeps the user's persona reactions when a moderator removes the user's reaction", async () => {
		const {owner, reactor, persona, reactionPath, listReactors} = await reactAsAccountAndPersona();

		await createBuilder(harness, owner.token)
			.delete(`${reactionPath}/${reactor.userId}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		expect(await listReactors()).toEqual([{id: reactor.userId, persona_id: persona.id}]);
	});

	it("removes only the named persona's reaction", async () => {
		const {reactor, persona, reactionPath, listReactors} = await reactAsAccountAndPersona();

		await createBuilder(harness, reactor.token)
			.delete(`${reactionPath}/@me?persona_id=${persona.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		expect(await listReactors()).toEqual([{id: reactor.userId, persona_id: null}]);
	});
});
