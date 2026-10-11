// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted, getMessages} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {PublicPersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const EMOJI = encodeURIComponent('👍');

// What is drawn beside a message, and its visibility. Nothing of the profile behind it.
const COPY_KEYS = [
	'avatar',
	'avatar_color',
	'color',
	'display_tag_icon',
	'display_tag_text',
	'id',
	'name',
	'pronouns',
	'visibility',
];

describe('The copy of a persona that travels with what it does', () => {
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

	async function setup(visibility: 'public' | 'unlisted' | 'private') {
		const {members, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [author, reader] = members as [TestAccount, TestAccount];
		await ensureSessionStarted(harness, author.token);
		await ensureSessionStarted(harness, reader.token);
		const persona = await createBuilder<{id: string}>(harness, author.token)
			.post('/users/@me/personas')
			.body({name: 'Fox', pronouns: 'they/them', bio: 'Kept for the profile', visibility})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		return {author, reader, channelId: systemChannel.id, personaId: persona.id};
	}

	it('carries no bio or banner on a message, for its author or anyone else', async () => {
		const {author, reader, channelId, personaId} = await setup('public');

		const sent = await createBuilder<MessageResponse>(harness, author.token)
			.post(`/channels/${channelId}/messages`)
			.body({content: 'hello', persona_id: personaId})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(Object.keys(sent.subprofile ?? {}).sort()).toEqual(COPY_KEYS);
		expect(sent.subprofile).toMatchObject({id: personaId, name: 'Fox', pronouns: 'they/them'});

		const read = (await getMessages(harness, reader.token, channelId)).find((m) => m.id === sent.id);
		expect(Object.keys(read?.subprofile ?? {}).sort()).toEqual(COPY_KEYS);

		const edited = await createBuilder<MessageResponse>(harness, author.token)
			.patch(`/channels/${channelId}/messages/${sent.id}`)
			.body({content: 'hello again'})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(Object.keys(edited.subprofile ?? {}).sort()).toEqual(COPY_KEYS);
	});

	it('carries the same on a reaction', async () => {
		const {author, reader, channelId, personaId} = await setup('public');
		const message = await createBuilder<MessageResponse>(harness, reader.token)
			.post(`/channels/${channelId}/messages`)
			.body({content: 'react to me'})
			.expect(HTTP_STATUS.OK)
			.execute();
		await createBuilder(harness, author.token)
			.put(`/channels/${channelId}/messages/${message.id}/reactions/${EMOJI}/@me`)
			.body({persona_id: personaId})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		const page = await createBuilder<{items: Array<{subprofile?: Record<string, unknown> | null}>}>(
			harness,
			reader.token,
		)
			.get(`/channels/${channelId}/messages/${message.id}/reactions/${EMOJI}/users`)
			.execute();
		expect(page.items).toHaveLength(1);
		expect(Object.keys(page.items[0].subprofile ?? {}).sort()).toEqual(COPY_KEYS);
	});

	it('leaves the profile to the fetch, which gives it for a public or unlisted persona', async () => {
		for (const visibility of ['public', 'unlisted'] as const) {
			const {author, reader, personaId} = await setup(visibility);
			const profile = await createBuilder<PublicPersonaResponse>(harness, reader.token)
				.get(`/users/${author.userId}/personas/${personaId}`)
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(profile.bio).toBe('Kept for the profile');
		}
	});

	it('gives a private persona’s bio to nobody but its owner, on a message or from the fetch', async () => {
		const {author, reader, channelId, personaId} = await setup('private');

		const sent = await createBuilder<MessageResponse>(harness, author.token)
			.post(`/channels/${channelId}/messages`)
			.body({content: 'hello', persona_id: personaId})
			.expect(HTTP_STATUS.OK)
			.execute();
		const read = (await getMessages(harness, reader.token, channelId)).find((m) => m.id === sent.id);
		expect(read?.subprofile?.name).toBe('Fox');
		expect(JSON.stringify(read)).not.toContain('Kept for the profile');

		await createBuilder(harness, reader.token)
			.get(`/users/${author.userId}/personas/${personaId}`)
			.expect(HTTP_STATUS.FORBIDDEN, 'PRIVATE_PERSONA')
			.execute();

		const own = await createBuilder<PublicPersonaResponse>(harness, author.token)
			.get(`/users/${author.userId}/personas/${personaId}`)
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(own.bio).toBe('Kept for the profile');
	});
});
