// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder, createBuilderWithoutAuth} from '@app/api/test/TestRequestBuilder';
import type {PersonaLookupResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

// What a message from a persona shows, and nothing of its profile (bio, banner, pronouns) or of how
// the account uses it.
const MESSAGE_LEVEL_KEYS = [
	'avatar',
	'avatar_color',
	'color',
	'display_tag_icon',
	'display_tag_text',
	'id',
	'name',
	'user_id',
	'visibility',
];

describe('Looking up personas by ID', () => {
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

	async function createPersona(token: string, body: Record<string, unknown>): Promise<{id: string}> {
		return createBuilder<{id: string}>(harness, token)
			.post('/users/@me/personas')
			.body(body)
			.expect(HTTP_STATUS.CREATED)
			.execute();
	}

	function lookup(token: string, personas: Array<{user_id: string; persona_id: string}>) {
		return createBuilder<PersonaLookupResponse>(harness, token).post('/personas/lookup').body({personas});
	}

	it('gives anyone signed in what a message shows, also for a private persona, and nothing of its profile', async () => {
		const owner = await createTestAccount(harness);
		const stranger = await createTestAccount(harness);
		const persona = await createPersona(owner.token, {
			name: 'Fox',
			pronouns: 'they/them',
			bio: 'Kept for the profile',
			visibility: 'private',
		});

		const found = await lookup(stranger.token, [{user_id: owner.userId, persona_id: persona.id}])
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(found).toHaveLength(1);
		expect(Object.keys(found[0]).sort()).toEqual(MESSAGE_LEVEL_KEYS);
		expect(found[0]).toMatchObject({id: persona.id, user_id: owner.userId, name: 'Fox', visibility: 'private'});
	});

	it('includes a deleted persona, as its old messages still show it', async () => {
		const owner = await createTestAccount(harness);
		const viewer = await createTestAccount(harness);
		const persona = await createPersona(owner.token, {name: 'Gone'});
		await createBuilder(harness, owner.token)
			.delete(`/users/@me/personas/${persona.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		const found = await lookup(viewer.token, [{user_id: owner.userId, persona_id: persona.id}])
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(found.map((p) => p.id)).toEqual([persona.id]);
		expect(found[0].name).toBe('Gone');
	});

	it('leaves out pairs that name no persona of that user, such as another account’s persona', async () => {
		const owner = await createTestAccount(harness);
		const other = await createTestAccount(harness);
		const viewer = await createTestAccount(harness);
		const own = await createPersona(owner.token, {name: 'Mine'});
		const theirs = await createPersona(other.token, {name: 'Theirs', visibility: 'private'});

		const found = await lookup(viewer.token, [
			{user_id: owner.userId, persona_id: own.id},
			{user_id: owner.userId, persona_id: theirs.id},
			{user_id: owner.userId, persona_id: '123456789012345678'},
		])
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(found.map((p) => p.id)).toEqual([own.id]);
	});

	it('looks up personas of several accounts in one request, each with its owner', async () => {
		const first = await createTestAccount(harness);
		const second = await createTestAccount(harness);
		const viewer = await createTestAccount(harness);
		const a = await createPersona(first.token, {name: 'First'});
		const b = await createPersona(second.token, {name: 'Second', visibility: 'private'});

		const found = await lookup(viewer.token, [
			{user_id: first.userId, persona_id: a.id},
			{user_id: second.userId, persona_id: b.id},
		])
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(found.map((p) => [p.user_id, p.name]).sort()).toEqual(
			[
				[first.userId, 'First'],
				[second.userId, 'Second'],
			].sort(),
		);
	});

	it('takes between 1 and 100 personas', async () => {
		const owner = await createTestAccount(harness);
		const pairs = Array.from({length: 101}, (_, i) => ({
			user_id: owner.userId,
			persona_id: String(100000000000000000n + BigInt(i)),
		}));

		await lookup(owner.token, []).expect(HTTP_STATUS.BAD_REQUEST).execute();
		await lookup(owner.token, pairs).expect(HTTP_STATUS.BAD_REQUEST).execute();
		await lookup(owner.token, pairs.slice(0, 100)).expect(HTTP_STATUS.OK).execute();
	});

	it('needs a signed-in user', async () => {
		const owner = await createTestAccount(harness);
		const persona = await createPersona(owner.token, {name: 'Fox'});

		await createBuilderWithoutAuth(harness)
			.post('/personas/lookup')
			.body({personas: [{user_id: owner.userId, persona_id: persona.id}]})
			.expect(HTTP_STATUS.UNAUTHORIZED)
			.execute();
	});
});
