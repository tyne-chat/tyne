// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannel, sendChannelMessage, setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {MessageReferenceTypes} from '@fluxer/constants/src/ChannelConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

// A forward's sender can be changed after it is sent, and nothing else about it (tyne-chat/tyne#817).
describe('Changing the persona of a forward', () => {
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

	async function forwardAsAccount() {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		await ensureSessionStarted(harness, owner.token);
		const destination = await createChannel(harness, owner.token, guild.id, 'forward-destination');
		const source = await sendChannelMessage(harness, owner.token, systemChannel.id, 'forward me');
		const persona = await createBuilder<{id: string; name: string}>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Mia'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const forward = await createBuilder<MessageResponse>(harness, owner.token)
			.post(`/channels/${destination.id}/messages`)
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
		return {owner, member: members[0]!, destination, persona, forward};
	}

	it('moves a forward to a persona and back to the account, and leaves the rest alone', async () => {
		const {owner, destination, persona, forward} = await forwardAsAccount();
		expect(forward.subprofile ?? null).toBeNull();

		const asPersona = await createBuilder<MessageResponse>(harness, owner.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({persona_id: persona.id})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(asPersona.subprofile?.id).toBe(persona.id);
		expect(asPersona.message_snapshots?.[0]?.content).toBe('forward me');
		expect(asPersona.content).toBe(forward.content);
		expect(asPersona.edited_timestamp ?? null).toBeNull();

		const asAccount = await createBuilder<MessageResponse>(harness, owner.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({persona_id: null})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(asAccount.subprofile ?? null).toBeNull();
		expect(asAccount.message_snapshots?.[0]?.content).toBe('forward me');
	});

	it('still refuses any other edit of a forward', async () => {
		const {owner, destination, persona, forward} = await forwardAsAccount();
		await createBuilder(harness, owner.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({content: 'new words'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
		await createBuilder(harness, owner.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({persona_id: persona.id, content: 'new words'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
		await createBuilder(harness, owner.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({persona_id: persona.id, flags: 0})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
	});

	it("refuses a change of persona on someone else's forward", async () => {
		const {member, destination, forward} = await forwardAsAccount();
		await ensureSessionStarted(harness, member.token);
		const theirs = await createBuilder<{id: string}>(harness, member.token)
			.post('/users/@me/personas')
			.body({name: 'Not the author'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		await createBuilder(harness, member.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({persona_id: theirs.id})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, member.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({persona_id: null})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
	});

	it("refuses another member's persona on a forward", async () => {
		const {owner, destination, forward} = await forwardAsAccount();
		const stranger = await setupTestGuildWithMembers(harness, 0);
		const theirs = await createBuilder<{id: string}>(harness, stranger.owner.token)
			.post('/users/@me/personas')
			.body({name: 'Not yours'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		await createBuilder(harness, owner.token)
			.patch(`/channels/${destination.id}/messages/${forward.id}`)
			.body({persona_id: theirs.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
		const fetched = await createBuilder<MessageResponse>(harness, owner.token)
			.get(`/channels/${destination.id}/messages/${forward.id}`)
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(fetched.subprofile ?? null).toBeNull();
	});
});
