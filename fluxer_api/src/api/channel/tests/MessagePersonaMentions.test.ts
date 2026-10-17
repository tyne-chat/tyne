// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createChannelID, createMessageID, createUserID} from '@app/api/BrandedTypes';
import {MessageResponseDataService} from '@app/api/channel/services/message/MessageResponseDataService';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted, getMessages} from '@app/api/message/tests/MessageTestUtils';
import {getChannelRepository, getUserRepository} from '@app/api/middleware/ServiceSingletons';
import {convertToSearchableMessage} from '@app/api/search/message/MessageSearchSerializer';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {MessageReferenceTypes} from '@fluxer/constants/src/ChannelConstants';
import {DELETED_USER_USERNAME, UserFlags} from '@fluxer/constants/src/UserConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {INatsConnectionManager} from '@pkgs/nats/src/INatsConnectionManager';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

class ExposedMessageResponseDataService extends MessageResponseDataService {
	constructor() {
		super({} as INatsConnectionManager);
	}

	hydrate(messages: Array<MessageResponse>): Promise<void> {
		return this.hydratePersonas(messages);
	}
}

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

	it('names the mentioned personas, once each', async () => {
		const bob = await createPersona('Bob the Fox', 'unlisted');
		const ada = await createPersona('Ada', 'public');

		const sent = await send(
			`hi <@${account.userId}:${bob.id}> and <@!${account.userId}:${ada.id}>, <@${account.userId}:${bob.id}>`,
		);

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

	it('names the personas a forwarded message mentions', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await ensureSessionStarted(harness, owner.token);
		const bob = await createBuilder<{id: string}>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Bob the Fox', visibility: 'unlisted'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const source = await createBuilder<MessageResponse>(harness, owner.token)
			.post(`/channels/${systemChannel.id}/messages`)
			.body({content: `hi <@${owner.userId}:${bob.id}>`})
			.expect(HTTP_STATUS.OK)
			.execute();

		const forward = await createBuilder<MessageResponse>(harness, owner.token)
			.post(`/channels/${systemChannel.id}/messages`)
			.body({
				message_reference: {
					message_id: source.id,
					channel_id: systemChannel.id,
					guild_id: guild.id,
					type: MessageReferenceTypes.FORWARD,
				},
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(forward.message_snapshots?.[0]?.content).toContain(bob.id);
		expect(forward.mention_personas?.map((persona) => persona.name)).toEqual(['Bob the Fox']);
	});

	it('leaves the field out of a message that mentions no persona', async () => {
		const sent = await send(`hi <@${account.userId}>`);

		expect(sent.mention_personas).toBeUndefined();
	});

	it('names the personas the messages service found, and takes its field off', async () => {
		const bob = await createPersona('Bob the Fox', 'unlisted');
		const fromService = (content: string, personaMentions?: Array<{user_id: string; persona_id: string}>) =>
			({
				id: '1',
				channel_id: account.userId,
				author: {id: account.userId, username: 'someone', flags: 0},
				content,
				...(personaMentions ? {persona_mentions: personaMentions} : {}),
			}) as unknown as MessageResponse;
		// The service reads mentions with the full Markdown parser, also in embeds and forwards; the
		// API takes its word for them and does not read the text again.
		const found = fromService('an embed mentioned someone', [{user_id: account.userId, persona_id: bob.id}]);
		const notFound = fromService(`<@${account.userId}:${bob.id}>`);

		await new ExposedMessageResponseDataService().hydrate([found, notFound]);

		expect(found.mention_personas?.map((persona) => persona.name)).toEqual(['Bob the Fox']);
		expect(notFound.mention_personas).toBeUndefined();
		expect(found).not.toHaveProperty('persona_mentions');
	});

	describe('stored for search, as upstream stores the accounts a message mentions', () => {
		const stored = async (channelId: string, messageId: string) =>
			(await getChannelRepository().messages.getMessage(
				createChannelID(BigInt(channelId)),
				createMessageID(BigInt(messageId)),
			))!;
		const searchedAs = async (channelId: string, messageId: string) =>
			convertToSearchableMessage(await stored(channelId, messageId)).mentionedPersonaIds;

		it('when sent and edited', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const member = members[0]!;
			await ensureSessionStarted(harness, owner.token);
			const persona = (name: string) =>
				createBuilder<{id: string}>(harness, member.token)
					.post('/users/@me/personas')
					.body({name, visibility: 'public'})
					.expect(HTTP_STATUS.CREATED)
					.execute();
			const bob = await persona('Bob');
			const ada = await persona('Ada');
			const sent = await createBuilder<MessageResponse>(harness, owner.token)
				.post(`/channels/${systemChannel.id}/messages`)
				.body({content: `hi <@${member.userId}:${bob.id}> \`<@${member.userId}:${ada.id}>\``})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(await searchedAs(systemChannel.id, sent.id)).toEqual([bob.id]);

			await createBuilder(harness, owner.token)
				.patch(`/channels/${systemChannel.id}/messages/${sent.id}`)
				.body({content: `now <@${member.userId}:${ada.id}>`})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(await searchedAs(systemChannel.id, sent.id)).toEqual([ada.id]);

			await createBuilder(harness, owner.token)
				.patch(`/channels/${systemChannel.id}/messages/${sent.id}`)
				.body({content: 'no one'})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(await searchedAs(systemChannel.id, sent.id)).toEqual([]);
		});

		it('not when the sender held the mention back, as the account is not stored either', async () => {
			const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
			const member = members[0]!;
			await ensureSessionStarted(harness, owner.token);
			const bob = await createBuilder<{id: string}>(harness, member.token)
				.post('/users/@me/personas')
				.body({name: 'Bob', visibility: 'public'})
				.expect(HTTP_STATUS.CREATED)
				.execute();
			const sent = await createBuilder<MessageResponse>(harness, owner.token)
				.post(`/channels/${systemChannel.id}/messages`)
				.body({content: `hi <@${member.userId}:${bob.id}>`, allowed_mentions: {parse: []}})
				.expect(HTTP_STATUS.OK)
				.execute();

			const message = await stored(systemChannel.id, sent.id);
			expect(message.mentionedUserIds.size).toBe(0);
			expect(await searchedAs(systemChannel.id, sent.id)).toEqual([]);
			// It is still shown as the persona.
			expect(sent.mention_personas?.map((persona) => persona.name)).toEqual(['Bob']);
		});
	});
});
