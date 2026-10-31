// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a forward has no text of its own, and the clients send it as a persona like any other
// message (tyne-chat/tyne#209).

import {sendChannelMessage, setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted, getMessages} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {MessageReferenceTypes} from '@fluxer/constants/src/ChannelConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('Forwarding a message as a persona', () => {
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

	async function setup() {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		await ensureSessionStarted(harness, owner.token);
		await ensureSessionStarted(harness, members[0]!.token);
		const source = await sendChannelMessage(harness, owner.token, systemChannel.id, 'forward me');
		const reference = {
			message_id: source.id,
			channel_id: systemChannel.id,
			guild_id: guild.id,
			type: MessageReferenceTypes.FORWARD,
		};
		const persona = await createBuilder<{id: string}>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Fox'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		return {owner, member: members[0]!, channelId: systemChannel.id, reference, persona};
	}

	it('names the persona on the forward and keeps the forwarded message', async () => {
		const {owner, channelId, reference, persona} = await setup();

		const forwarded = await createBuilder<MessageResponse>(harness, owner.token)
			.post(`/channels/${channelId}/messages`)
			.body({message_reference: reference, persona_id: persona.id})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(forwarded.subprofile?.id).toBe(persona.id);
		expect(forwarded.subprofile?.name).toBe('Fox');
		expect(forwarded.message_snapshots?.[0]?.content).toBe('forward me');

		const messages = await getMessages(harness, owner.token, channelId);
		expect(messages.find((message) => message.id === forwarded.id)?.subprofile?.id).toBe(persona.id);
	});

	it("refuses to forward as another member's persona", async () => {
		const {member, channelId, reference, persona} = await setup();

		await createBuilder(harness, member.token)
			.post(`/channels/${channelId}/messages`)
			.body({message_reference: reference, persona_id: persona.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
	});
});
