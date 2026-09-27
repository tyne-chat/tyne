// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelPersonaMentionItem, PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {Config} from '../../Config';
import {createChannel, createDmChannel, createGuild} from '../../channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

async function createPersona(
	harness: ApiTestHarness,
	token: string,
	data: {name: string; visibility: 'public' | 'unlisted' | 'private'},
): Promise<PersonaResponse> {
	return createBuilder<PersonaResponse>(harness, token)
		.post('/users/@me/personas')
		.body(data)
		.expect(HTTP_STATUS.CREATED)
		.execute();
}

describe('Channel Persona Mentions and Privacy Filtering', () => {
	let harness: ApiTestHarness;
	let userA: TestAccount;
	let userB: TestAccount;
	let userC: TestAccount;
	let channelId: string;

	beforeEach(async () => {
		harness = await createApiTestHarness();
		userA = await createTestAccount(harness);
		userB = await createTestAccount(harness);
		userC = await createTestAccount(harness);

		// User A creates a guild and channel
		const guild = await createGuild(harness, userA.token, 'Test Guild');
		const channel = await createChannel(harness, userA.token, guild.id, 'general');
		channelId = channel.id;

		// Add User B to the guild via invite
		const invite = await createBuilder<{code: string}>(harness, userA.token)
			.post(`/channels/${channelId}/invites`)
			.body({})
			.execute();
		await createBuilder(harness, userB.token).post(`/invites/${invite.code}`).execute();
	});

	afterEach(() => {
		Config.dev.validateResponses = true;
	});

	test('allows other users public and unlisted personas in channel mentions but strictly filters private personas', async () => {
		// User B creates public, unlisted, and private personas
		await createPersona(harness, userB.token, {name: 'Bob Public', visibility: 'public'});
		await createPersona(harness, userB.token, {name: 'Bob Unlisted', visibility: 'unlisted'});
		await createPersona(harness, userB.token, {name: 'Bob Private', visibility: 'private'});

		// User A creates public, unlisted, and private personas
		await createPersona(harness, userA.token, {name: 'Alice Public', visibility: 'public'});
		await createPersona(harness, userA.token, {name: 'Alice Unlisted', visibility: 'unlisted'});
		await createPersona(harness, userA.token, {name: 'Alice Private', visibility: 'private'});

		// User A fetches channel persona mentions
		const results = await createBuilder<Array<ChannelPersonaMentionItem>>(harness, userA.token)
			.get(`/channels/${channelId}/persona-mentions`)
			.expect(HTTP_STATUS.OK)
			.execute();

		const names = results.map((r) => r.name);

		// User A can see own personas regardless of visibility
		expect(names).toContain('Alice Public');
		expect(names).toContain('Alice Unlisted');
		expect(names).toContain('Alice Private');

		// User A can see User B's public and unlisted personas
		expect(names).toContain('Bob Public');
		expect(names).toContain('Bob Unlisted');

		// User A MUST NOT see User B's private personas
		expect(names).not.toContain('Bob Private');

		// Verify owner_discriminator is populated on mention items
		const bobPublicItem = results.find((r) => r.name === 'Bob Public');
		expect(bobPublicItem).toBeDefined();
		expect(bobPublicItem?.owner_discriminator).toBeDefined();
	});

	test('filters candidates by search query', async () => {
		await createPersona(harness, userB.token, {name: 'Bob Public', visibility: 'public'});
		await createPersona(harness, userB.token, {name: 'Bob Unlisted', visibility: 'unlisted'});
		await createPersona(harness, userA.token, {name: 'Alice Public', visibility: 'public'});
		await createPersona(harness, userA.token, {name: 'Alice Unlisted', visibility: 'unlisted'});

		// Query "bob"
		const bobResults = await createBuilder<Array<ChannelPersonaMentionItem>>(harness, userA.token)
			.get(`/channels/${channelId}/persona-mentions?q=bob`)
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(bobResults.map((r) => r.name).sort()).toEqual(['Bob Public', 'Bob Unlisted'].sort());

		// Query "unlisted" should find both Alice's and Bob's unlisted personas
		const unlistedResults = await createBuilder<Array<ChannelPersonaMentionItem>>(harness, userA.token)
			.get(`/channels/${channelId}/persona-mentions?q=unlisted`)
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(unlistedResults.map((r) => r.name).sort()).toEqual(['Alice Unlisted', 'Bob Unlisted'].sort());
	});

	test('rejects queries from users without channel view permission', async () => {
		// User C is not in the guild and cannot view the channel
		await createBuilder(harness, userC.token)
			.get(`/channels/${channelId}/persona-mentions`)
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
	});

	test('returns persona mentions in 1-on-1 DM channel', async () => {
		const dmChannel = await createDmChannel(harness, userA.token, userB.userId);

		await createPersona(harness, userB.token, {name: 'Bob DM Public', visibility: 'public'});
		await createPersona(harness, userB.token, {name: 'Bob DM Private', visibility: 'private'});
		await createPersona(harness, userA.token, {name: 'Alice DM Public', visibility: 'public'});

		const results = await createBuilder<Array<ChannelPersonaMentionItem>>(harness, userA.token)
			.get(`/channels/${dmChannel.id}/persona-mentions`)
			.expect(HTTP_STATUS.OK)
			.execute();

		const names = results.map((r) => r.name);
		expect(names).toContain('Alice DM Public');
		expect(names).toContain('Bob DM Public');
		expect(names).not.toContain('Bob DM Private');
	});

	test('returns persona mentions in personal notes channel', async () => {
		await createPersona(harness, userA.token, {name: 'Alice Notes Only', visibility: 'private'});

		const results = await createBuilder<Array<ChannelPersonaMentionItem>>(harness, userA.token)
			.get(`/channels/${userA.userId}/persona-mentions`)
			.expect(HTTP_STATUS.OK)
			.execute();

		const names = results.map((r) => r.name);
		expect(names).toContain('Alice Notes Only');
	});

	test('ensures caller is included in candidates when caller is not in channel candidate repository', async () => {
		// User C joins guild but has never spoken in channel
		const invite = await createBuilder<{code: string}>(harness, userA.token)
			.post(`/channels/${channelId}/invites`)
			.body({})
			.execute();
		await createBuilder(harness, userC.token).post(`/invites/${invite.code}`).execute();

		await createPersona(harness, userC.token, {name: 'Charlie Lurker', visibility: 'public'});

		const results = await createBuilder<Array<ChannelPersonaMentionItem>>(harness, userC.token)
			.get(`/channels/${channelId}/persona-mentions`)
			.expect(HTTP_STATUS.OK)
			.execute();

		const names = results.map((r) => r.name);
		expect(names).toContain('Charlie Lurker');
	});
});
