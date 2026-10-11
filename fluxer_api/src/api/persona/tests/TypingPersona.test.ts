// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {IndicateTypingRequestSchema} from '@fluxer/schema/src/domains/message/MessageRequestSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi} from 'vitest';

interface TypingStart {
	channel_id: string;
	user_id: string;
	subprofile?: Record<string, unknown>;
}

describe('Typing as a persona', () => {
	let harness: ApiTestHarness;
	let guildDispatch: MockInstance<NoopGatewayService['dispatchGuild']>;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
		guildDispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
	});
	afterEach(() => {
		guildDispatch.mockRestore();
	});
	afterAll(async () => {
		await harness.shutdown();
	});

	async function setupChannel(): Promise<{typist: TestAccount; other: TestAccount; channelId: string}> {
		const {members, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [typist, other] = members as [TestAccount, TestAccount];
		await ensureSessionStarted(harness, typist.token);
		await ensureSessionStarted(harness, other.token);
		return {typist, other, channelId: systemChannel.id};
	}

	async function createPersona(token: string, body: Record<string, unknown>): Promise<{id: string; name: string}> {
		return createBuilder<{id: string; name: string}>(harness, token)
			.post('/users/@me/personas')
			.body(body)
			.expect(HTTP_STATUS.CREATED)
			.execute();
	}

	function typing(token: string, channelId: string, body?: Record<string, unknown>) {
		const request = createBuilder<void>(harness, token).post(`/channels/${channelId}/typing`);
		return body === undefined ? request : request.body(body);
	}

	function typingStarts(): Array<TypingStart> {
		return guildDispatch.mock.calls
			.map(([params]) => params)
			.filter((params) => params.event === 'TYPING_START')
			.map((params) => params.data as TypingStart);
	}

	it('accepts persona_id, and still the subprofile object older clients send', () => {
		expect(IndicateTypingRequestSchema.safeParse({persona_id: '1546500000000000003'}).success).toBe(true);
		expect(IndicateTypingRequestSchema.safeParse({persona_id: 'not-a-snowflake'}).success).toBe(false);
		const legacy = IndicateTypingRequestSchema.safeParse({subprofile: {id: '1546500000000000003', name: 'Fox'}});
		expect(legacy.success && legacy.data?.subprofile).toEqual({id: '1546500000000000003'});
		expect(IndicateTypingRequestSchema.safeParse(undefined).success).toBe(true);
	});

	it('shows the persona the id names, with the account’s display tag and without its profile', async () => {
		const {typist, channelId} = await setupChannel();
		const persona = await createPersona(typist.token, {name: 'Fox', pronouns: 'they/them', bio: 'Not for typing'});
		await createBuilder(harness, typist.token)
			.patch('/users/@me/personas/settings')
			.body({display_tag_text: 'The Den'})
			.expect(HTTP_STATUS.OK)
			.execute();

		await typing(typist.token, channelId, {persona_id: persona.id}).expect(HTTP_STATUS.NO_CONTENT).execute();

		const [start] = typingStarts();
		expect(start.user_id).toBe(typist.userId);
		expect(start.subprofile).toEqual({
			id: persona.id,
			name: 'Fox',
			avatar: null,
			avatar_color: null,
			display_tag_text: 'The Den',
			display_tag_icon: null,
			pronouns: 'they/them',
			color: null,
			visibility: 'unlisted',
		});
	});

	it('ignores what a request says a persona is called or looks like', async () => {
		const {typist, channelId} = await setupChannel();
		const persona = await createPersona(typist.token, {name: 'Fox'});

		await typing(typist.token, channelId, {
			subprofile: {
				id: persona.id,
				name: 'Somebody Else',
				avatar: 'https://example.com/avatar.png',
				display_tag_text: 'Made Up',
				display_tag_icon: 'https://example.com/icon.png',
			},
		})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		const [start] = typingStarts();
		expect(start.subprofile?.id).toBe(persona.id);
		expect(start.subprofile?.name).toBe('Fox');
		expect(start.subprofile?.avatar).toBeNull();
		expect(start.subprofile?.display_tag_text).toBeNull();
		expect(start.subprofile?.display_tag_icon).toBeNull();
	});

	it('shows nobody typing for a persona of another member, a deleted one, or an id that is not one', async () => {
		const {typist, other, channelId} = await setupChannel();
		const theirs = await createPersona(other.token, {name: 'Owl'});
		const deleted = await createPersona(typist.token, {name: 'Gone'});
		await createBuilder(harness, typist.token)
			.delete(`/users/@me/personas/${deleted.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		await typing(typist.token, channelId, {persona_id: theirs.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
		await typing(typist.token, channelId, {persona_id: deleted.id})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
		await typing(typist.token, channelId, {subprofile: {id: 'persona_test_1', name: 'Persona Alice'}})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();

		expect(typingStarts()).toEqual([]);
	});

	it('shows the account typing when the request names no persona', async () => {
		const {typist, channelId} = await setupChannel();

		await typing(typist.token, channelId).expect(HTTP_STATUS.NO_CONTENT).execute();
		await typing(typist.token, channelId, {persona_id: null}).expect(HTTP_STATUS.NO_CONTENT).execute();

		const starts = typingStarts();
		expect(starts).toHaveLength(2);
		for (const start of starts) {
			expect(start.user_id).toBe(typist.userId);
			expect(start.subprofile).toBeUndefined();
		}
	});
});
