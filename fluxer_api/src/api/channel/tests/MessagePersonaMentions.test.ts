// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {ensureSessionStarted, getMessages} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
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

	it('leaves out private personas, mentions in code and personas of another account', async () => {
		const hidden = await createPersona('Hidden', 'private');
		const shown = await createPersona('Shown', 'unlisted');
		const other = await createTestAccount(harness);

		const sent = await send(
			[
				`<@${account.userId}:${hidden.id}>`,
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
