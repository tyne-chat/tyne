// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: `use_persona_selection` on a new message, for senders that cannot see the selection, such
// as a reply typed in a notification (tyne-chat/tyne#343). The server decides the persona the way
// the clients do, and only when asked.

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createChannel, setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {PersonaResponse, PersonaSettingsResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('sending as the selected persona when asked', () => {
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

	async function setup(): Promise<{owner: TestAccount; guildId: string; channelId: string}> {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await ensureSessionStarted(harness, owner.token);
		return {owner, guildId: guild.id, channelId: systemChannel.id};
	}

	function createPersona(account: TestAccount, name: string, prefix: string): Promise<PersonaResponse> {
		return createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({name, persona_tags: [{prefix}]})
			.expect(HTTP_STATUS.CREATED)
			.execute();
	}

	function changeSettings(account: TestAccount, body: Record<string, unknown>): Promise<PersonaSettingsResponse> {
		return createBuilder<PersonaSettingsResponse>(harness, account.token)
			.patch('/users/@me/personas/settings')
			.body(body)
			.execute();
	}

	function send(account: TestAccount, channelId: string, body: Record<string, unknown>): Promise<MessageResponse> {
		return createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${channelId}/messages`)
			.body(body)
			.expect(HTTP_STATUS.OK)
			.execute();
	}

	it('sends as the latched persona only when asked', async () => {
		const {owner, channelId} = await setup();
		const fox = await createPersona(owner, 'Fox', 'F:');
		await changeSettings(owner, {active_persona_id: fox.id, is_latched: true});

		const asked = await send(owner, channelId, {content: 'hello', use_persona_selection: true});
		expect(asked.subprofile?.id).toBe(fox.id);
		expect(asked.content).toBe('hello');

		const notAsked = await send(owner, channelId, {content: 'hello'});
		expect(notAsked.subprofile ?? null).toBeNull();
	});

	it('uses no persona that is selected but not latched', async () => {
		const {owner, channelId} = await setup();
		const fox = await createPersona(owner, 'Fox', 'F:');
		await changeSettings(owner, {active_persona_id: fox.id, is_latched: false});

		const sent = await send(owner, channelId, {content: 'hello', use_persona_selection: true});
		expect(sent.subprofile ?? null).toBeNull();
	});

	it('lets a tag in the text win over the selection, and takes the tag out', async () => {
		const {owner, channelId} = await setup();
		const fox = await createPersona(owner, 'Fox', 'F:');
		const owl = await createPersona(owner, 'Owl', 'O:');
		await changeSettings(owner, {active_persona_id: fox.id, is_latched: true});

		const sent = await send(owner, channelId, {content: 'O: hoot', use_persona_selection: true});
		expect(sent.subprofile?.id).toBe(owl.id);
		expect(sent.content).toBe('hoot');
	});

	it('matches a tag with nothing selected', async () => {
		const {owner, channelId} = await setup();
		const owl = await createPersona(owner, 'Owl', 'O:');

		const sent = await send(owner, channelId, {content: 'O: hoot', use_persona_selection: true});
		expect(sent.subprofile?.id).toBe(owl.id);
		expect(sent.content).toBe('hoot');
	});

	it('uses the channel’s own selection when selections are kept per channel', async () => {
		const {owner, guildId, channelId} = await setup();
		const other = await createChannel(harness, owner.token, guildId, 'other');
		const fox = await createPersona(owner, 'Fox', 'F:');
		const owl = await createPersona(owner, 'Owl', 'O:');
		await changeSettings(owner, {active_persona_scope: 'channel', active_persona_id: owl.id, is_latched: true});
		await createBuilder(harness, owner.token)
			.put(`/users/@me/personas/channel-states/${channelId}`)
			.body({persona_id: fox.id})
			.execute();

		const here = await send(owner, channelId, {content: 'hello', use_persona_selection: true});
		expect(here.subprofile?.id).toBe(fox.id);

		const elsewhere = await send(owner, other.id, {content: 'hello', use_persona_selection: true});
		expect(elsewhere.subprofile ?? null).toBeNull();
	});

	it('sends as the account after a backslash, and leaves the selection as it was', async () => {
		const {owner, channelId} = await setup();
		const fox = await createPersona(owner, 'Fox', 'F:');
		await changeSettings(owner, {active_persona_id: fox.id, is_latched: true});

		const once = await send(owner, channelId, {content: '\\ just me', use_persona_selection: true});
		expect(once.subprofile ?? null).toBeNull();
		expect(once.content).toBe('just me');

		const unlatch = await send(owner, channelId, {content: '\\\\ still me', use_persona_selection: true});
		expect(unlatch.subprofile ?? null).toBeNull();
		expect(unlatch.content).toBe('still me');

		const settings = await createBuilder<PersonaSettingsResponse>(harness, owner.token)
			.get('/users/@me/personas/settings')
			.execute();
		expect(settings.active_persona_id).toBe(fox.id);
		expect(settings.is_latched).toBe(true);
	});

	it('sends as the account when the selected persona was deleted', async () => {
		const {owner, channelId} = await setup();
		const fox = await createPersona(owner, 'Fox', 'F:');
		await changeSettings(owner, {active_persona_id: fox.id, is_latched: true});
		await createBuilder(harness, owner.token)
			.delete(`/users/@me/personas/${fox.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		const sent = await send(owner, channelId, {content: 'F: hello', use_persona_selection: true});
		expect(sent.subprofile ?? null).toBeNull();
		expect(sent.content).toBe('F: hello');
	});

	it('lets persona_id decide when it is sent as well', async () => {
		const {owner, channelId} = await setup();
		const fox = await createPersona(owner, 'Fox', 'F:');
		const owl = await createPersona(owner, 'Owl', 'O:');
		await changeSettings(owner, {active_persona_id: fox.id, is_latched: true});

		const asOwl = await send(owner, channelId, {content: 'F: hi', persona_id: owl.id, use_persona_selection: true});
		expect(asOwl.subprofile?.id).toBe(owl.id);
		expect(asOwl.content).toBe('F: hi');

		const asAccount = await send(owner, channelId, {content: 'hi', persona_id: null, use_persona_selection: true});
		expect(asAccount.subprofile ?? null).toBeNull();
	});
});
