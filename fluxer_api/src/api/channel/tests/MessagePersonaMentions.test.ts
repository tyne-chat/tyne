// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createUserID} from '@app/api/BrandedTypes';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted, getMessages} from '@app/api/message/tests/MessageTestUtils';
import {getUserRepository} from '@app/api/middleware/ServiceSingletons';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {DELETED_USER_USERNAME, UserFlags} from '@fluxer/constants/src/UserConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

// Fork: the personas a message mentions travel with it, as upstream's `mentions` carries the
// accounts it mentions, so clients and push previews can name them.

describe('personas mentioned in a message', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
		account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
	});
	afterAll(async () => {
		await harness?.shutdown();
	});

	const createPersona = (name: string, visibility: 'public' | 'unlisted' | 'private') =>
		createBuilder<{id: string}>(harness, account.token)
			.post('/users/@me/personas')
			.body({name, visibility})
			.expect(HTTP_STATUS.CREATED)
			.execute();

	const send = (content: string) =>
		createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${account.userId}/messages`)
			.body({content})
			.expect(HTTP_STATUS.OK)
			.execute();

	const fetchAgain = async (message: MessageResponse) =>
		(await getMessages(harness, account.token, account.userId)).find((m) => m.id === message.id)!;

	it('names the mentioned personas, in the order they appear', async () => {
		const bob = await createPersona('Bob the Fox', 'unlisted');
		const ada = await createPersona('Ada', 'public');

		const sent = await send(`hi <@${account.userId}:${bob.id}> and <@!${account.userId}:${ada.id}>`);

		expect(sent.mention_personas?.map((persona) => [persona.id, persona.name])).toEqual([
			[bob.id, 'Bob the Fox'],
			[ada.id, 'Ada'],
		]);
		expect((await fetchAgain(sent)).mention_personas?.map((persona) => persona.name)).toEqual(['Bob the Fox', 'Ada']);
	});

	it('gives the name a persona has now, not the one it had when mentioned', async () => {
		const bob = await createPersona('Bob the Fox', 'unlisted');
		const sent = await send(`hi <@${account.userId}:${bob.id}>`);

		await createBuilder(harness, account.token)
			.patch(`/users/@me/personas/${bob.id}`)
			.body({name: 'Robert'})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect((await fetchAgain(sent)).mention_personas?.map((persona) => persona.name)).toEqual(['Robert']);
	});

	it('names private personas, and deleted ones as they were', async () => {
		const hidden = await createPersona('Hidden', 'private');
		const gone = await createPersona('Gone', 'unlisted');
		const sent = await send(`<@${account.userId}:${hidden.id}> <@${account.userId}:${gone.id}>`);

		await createBuilder(harness, account.token)
			.delete(`/users/@me/personas/${gone.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		expect((await fetchAgain(sent)).mention_personas?.map((persona) => persona.name)).toEqual(['Hidden', 'Gone']);
	});

	it('names a persona "Deleted Persona" once its account is deleted', async () => {
		const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const member = members[0]!;
		await ensureSessionStarted(harness, owner.token);
		const bob = await createBuilder<{id: string}>(harness, member.token)
			.post('/users/@me/personas')
			.body({name: 'Bob the Fox', visibility: 'unlisted'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const sent = await createBuilder<MessageResponse>(harness, owner.token)
			.post(`/channels/${systemChannel.id}/messages`)
			.body({content: `hi <@${member.userId}:${bob.id}>`})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(sent.mention_personas?.map((persona) => persona.name)).toEqual(['Bob the Fox']);

		await getUserRepository().patchUpsert(createUserID(BigInt(member.userId)), {
			username: DELETED_USER_USERNAME,
			flags: BigInt(UserFlags.DELETED),
		});

		const again = (await getMessages(harness, owner.token, systemChannel.id)).find((m) => m.id === sent.id)!;
		expect(again.mention_personas).toEqual([
			expect.objectContaining({id: bob.id, name: 'Deleted Persona', avatar: null}),
		]);
	});

	it('leaves out mentions in code and personas the mentioned account does not have', async () => {
		const shown = await createPersona('Shown', 'unlisted');
		const other = await createTestAccount(harness);

		const sent = await send(
			[
				`\`<@${account.userId}:${shown.id}>\``,
				'```',
				`<@${account.userId}:${shown.id}>`,
				'```',
				`<@${other.userId}:${shown.id}>`,
			].join('\n'),
		);

		expect(sent.mention_personas ?? []).toEqual([]);
	});

	it('leaves the field out of a message that mentions no persona', async () => {
		const sent = await send(`hi <@${account.userId}>`);

		expect(sent.mention_personas).toBeUndefined();
	});
});
