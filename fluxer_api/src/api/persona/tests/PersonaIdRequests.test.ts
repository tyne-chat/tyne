// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted, getMessages} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {
	MessageRequestSchema,
	MessageUpdateRequestSchema,
} from '@fluxer/schema/src/domains/message/MessageRequestSchemas';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('Naming the persona of a message with persona_id', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
	});
	afterAll(async () => {
		await harness.shutdown();
	});

	async function createPersona(token: string, name: string): Promise<{id: string; name: string}> {
		return createBuilder<{id: string; name: string}>(harness, token)
			.post('/users/@me/personas')
			.body({name})
			.expect(HTTP_STATUS.CREATED)
			.execute();
	}

	async function setupChannel(): Promise<{author: TestAccount; other: TestAccount; channelId: string}> {
		const {members, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [author, other] = members as [TestAccount, TestAccount];
		await ensureSessionStarted(harness, author.token);
		await ensureSessionStarted(harness, other.token);
		return {author, other, channelId: systemChannel.id};
	}

	function send(token: string, channelId: string, body: Record<string, unknown>) {
		return createBuilder<MessageResponse>(harness, token).post(`/channels/${channelId}/messages`).body(body);
	}

	function edit(token: string, channelId: string, messageId: string, body: Record<string, unknown>) {
		return createBuilder<MessageResponse>(harness, token)
			.patch(`/channels/${channelId}/messages/${messageId}`)
			.body(body);
	}

	it('accepts persona_id on a new message and on an edit', () => {
		expect(MessageRequestSchema.safeParse({content: 'hi', persona_id: '1546500000000000003'}).success).toBe(true);
		expect(MessageUpdateRequestSchema.safeParse({persona_id: '1546500000000000003'}).success).toBe(true);
		expect(MessageUpdateRequestSchema.safeParse({persona_id: null}).success).toBe(true);
		expect(MessageRequestSchema.safeParse({content: 'hi', persona_id: 'not-a-snowflake'}).success).toBe(false);
	});

	it('sends a message as the persona the id names', async () => {
		const {author, other, channelId} = await setupChannel();
		const persona = await createPersona(author.token, 'Fox');

		const sent = await send(author.token, channelId, {content: 'hello', persona_id: persona.id})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(sent.subprofile?.id).toBe(persona.id);
		expect(sent.subprofile?.name).toBe('Fox');

		const seenByOther = (await getMessages(harness, other.token, channelId)).find((m) => m.id === sent.id);
		expect(seenByOther?.subprofile?.name).toBe('Fox');
	});

	it('lets persona_id decide when an older subprofile object is sent with it', async () => {
		const {author, channelId} = await setupChannel();
		const fox = await createPersona(author.token, 'Fox');
		const owl = await createPersona(author.token, 'Owl');

		const asFox = await send(author.token, channelId, {
			content: 'both',
			persona_id: fox.id,
			subprofile: {id: owl.id, name: 'Owl'},
		})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(asFox.subprofile?.name).toBe('Fox');

		const asAccount = await send(author.token, channelId, {
			content: 'account',
			persona_id: null,
			subprofile: {id: owl.id, name: 'Owl'},
		})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(asAccount.subprofile ?? null).toBeNull();
	});

	it('takes the persona’s name from the account’s records, whatever an older client says it is', async () => {
		const {author, channelId} = await setupChannel();
		const persona = await createPersona(author.token, 'Fox');

		const sent = await send(author.token, channelId, {
			content: 'legacy',
			subprofile: {id: persona.id, name: 'Somebody Else', avatar: 'https://example.com/a.png', bio: 'made up'},
		})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(sent.subprofile?.name).toBe('Fox');
	});

	it('refuses a persona_id that belongs to another member, and one that is not an id', async () => {
		const {author, other, channelId} = await setupChannel();
		const persona = await createPersona(author.token, 'Fox');

		await send(other.token, channelId, {content: 'forged', persona_id: persona.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
		await send(other.token, channelId, {content: 'malformed', persona_id: 'not-a-snowflake'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
		await send(other.token, channelId, {content: 'oversized', persona_id: '9'.repeat(40)})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
		// The id of the older object was never validated as an id, so it is refused as an unknown persona.
		await send(other.token, channelId, {content: 'oversized', subprofile: {id: '9'.repeat(64), name: 'Nobody'}})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();

		const messages = await getMessages(harness, author.token, channelId);
		expect(messages.some((m) => ['forged', 'malformed', 'oversized'].includes(m.content))).toBe(false);
	});

	it('on an edit sets the persona, leaves it alone when nothing is said, and removes it on null', async () => {
		const {author, channelId} = await setupChannel();
		const fox = await createPersona(author.token, 'Fox');
		const owl = await createPersona(author.token, 'Owl');
		const sent = await send(author.token, channelId, {content: 'first', persona_id: fox.id})
			.expect(HTTP_STATUS.OK)
			.execute();

		const contentOnly = await edit(author.token, channelId, sent.id, {content: 'second'})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(contentOnly.content).toBe('second');
		expect(contentOnly.subprofile?.name).toBe('Fox');

		const changed = await edit(author.token, channelId, sent.id, {persona_id: owl.id}).expect(HTTP_STATUS.OK).execute();
		expect(changed.subprofile?.name).toBe('Owl');

		const removed = await edit(author.token, channelId, sent.id, {persona_id: null}).expect(HTTP_STATUS.OK).execute();
		expect(removed.subprofile ?? null).toBeNull();

		const fetched = (await getMessages(harness, author.token, channelId)).find((m) => m.id === sent.id);
		expect(fetched?.content).toBe('second');
		expect(fetched?.subprofile ?? null).toBeNull();
	});

	it('refuses an edit onto another member’s persona and leaves the message as it was', async () => {
		const {author, other, channelId} = await setupChannel();
		const persona = await createPersona(author.token, 'Fox');
		const plain = await send(other.token, channelId, {content: 'plain'}).expect(HTTP_STATUS.OK).execute();

		await edit(other.token, channelId, plain.id, {persona_id: persona.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();

		const fetched = (await getMessages(harness, author.token, channelId)).find((m) => m.id === plain.id);
		expect(fetched?.subprofile ?? null).toBeNull();
	});

	it('keeps a message editable by persona_id after its persona was deleted', async () => {
		const {author, channelId} = await setupChannel();
		const persona = await createPersona(author.token, 'Short Lived');
		const sent = await send(author.token, channelId, {content: 'before', persona_id: persona.id})
			.expect(HTTP_STATUS.OK)
			.execute();
		await createBuilder(harness, author.token)
			.delete(`/users/@me/personas/${persona.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		const edited = await edit(author.token, channelId, sent.id, {content: 'after', persona_id: persona.id})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(edited.content).toBe('after');
		expect(edited.subprofile?.id).toBe(persona.id);

		await send(author.token, channelId, {content: 'new', persona_id: persona.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
	});
});
