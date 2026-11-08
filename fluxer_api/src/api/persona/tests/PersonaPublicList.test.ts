// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaResponse, PublicPersonaListResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import type {PersonaID, UserID} from '../../BrandedTypes';
import {createFriendship} from '../../channel/tests/ChannelTestUtils';
import type {PersonaRow, UserPersonaSettingsRow} from '../../database/types/PersonaTypes';
import {Persona} from '../../models/Persona';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';
import type {IPersonaRepository} from '../IPersonaRepository';
import {PersonaService} from '../PersonaService';

const userId = 1000000000000000001n as UserID;

function persona(personaId: bigint, name: string, options: Partial<PersonaRow> = {}): Persona {
	return new Persona({
		user_id: userId,
		persona_id: personaId as PersonaID,
		name,
		avatar_hash: null,
		banner_hash: null,
		avatar_color: null,
		pronouns: null,
		color: null,
		bio: null,
		auto_tag_disabled: false,
		persona_tags: '[]',
		use_count: 0,
		last_used_at_ms: null,
		visibility: 'public',
		external_uuid: null,
		created_at: new Date('2026-01-01T00:00:00Z'),
		updated_at: new Date('2026-01-01T00:00:00Z'),
		version: 1,
		...options,
	});
}

function serviceWith(personas: Array<Persona>, settings: Partial<UserPersonaSettingsRow> | null): PersonaService {
	const repo = {
		findByUserId: vi.fn().mockResolvedValue(personas),
		findSettings: vi.fn().mockResolvedValue(settings),
	} as unknown as IPersonaRepository;
	return new PersonaService({personaRepository: repo});
}

describe('getPublicPersonas', () => {
	it('lists public personas only, the most used first, ties in the order they were made', async () => {
		const service = serviceWith(
			[
				persona(30n, 'Seldom', {use_count: 2}),
				persona(10n, 'Often', {use_count: 40}),
				persona(20n, 'Hidden', {use_count: 99, visibility: 'unlisted'}),
				persona(40n, 'Secret', {use_count: 99, visibility: 'private'}),
				persona(25n, 'Tie later', {use_count: 2}),
				persona(5n, 'Never', {use_count: 0}),
			],
			null,
		);

		const list = await service.getPublicPersonas(userId, userId);

		expect(list.personas.map((p) => p.name)).toEqual(['Often', 'Tie later', 'Seldom', 'Never']);
	});

	it('gives the order and nothing else of the usage counters', async () => {
		const service = serviceWith([persona(10n, 'Often', {use_count: 40, last_used_at_ms: 1_800_000_000_000n})], null);

		const list = await service.getPublicPersonas(userId, userId);

		expect(list.personas[0]).not.toHaveProperty('use_count');
		expect(list.personas[0]).not.toHaveProperty('last_used_at_ms');
	});

	it("carries the account's display tag, also when no persona is public", async () => {
		const service = serviceWith([persona(10n, 'Hidden', {visibility: 'unlisted'})], {
			display_tag_text: '  LANTERN ',
			display_tag_icon: 'a'.repeat(32),
		});

		const list = await service.getPublicPersonas(userId, userId);

		expect(list).toEqual({display_tag_text: 'LANTERN', display_tag_icon: 'a'.repeat(32), personas: []});
	});

	it('answers a missing or blank display tag as none', async () => {
		expect((await serviceWith([], null).getPublicPersonas(userId, userId)).display_tag_text).toBeNull();
		const blank = await serviceWith([], {display_tag_text: '   ', display_tag_icon: ''}).getPublicPersonas(
			userId,
			userId,
		);
		expect(blank.display_tag_text).toBeNull();
		expect(blank.display_tag_icon).toBeNull();
	});
});

describe('GET /users/:user_id/personas', () => {
	let harness: ApiTestHarness;
	let owner: TestAccount;
	let friend: TestAccount;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
		owner = await createTestAccount(harness);
		friend = await createTestAccount(harness);
		await createFriendship(harness, owner, friend);
	});
	afterAll(async () => {
		await harness?.shutdown();
	});

	it("returns the owner's display tag with the public personas", async () => {
		await createBuilder(harness, owner.token)
			.patch('/users/@me/personas/settings')
			.body({display_tag_text: 'LANTERN'})
			.expect(HTTP_STATUS.OK)
			.execute();
		const shown = await createBuilder<PersonaResponse>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Shown', visibility: 'public'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		await createBuilder<PersonaResponse>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Unlisted'})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const list = await createBuilder<PublicPersonaListResponse>(harness, friend.token)
			.get(`/users/${owner.userId}/personas`)
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(list.display_tag_text).toBe('LANTERN');
		expect(list.display_tag_icon).toBeNull();
		expect(list.personas.map((p) => p.id)).toEqual([shown.id]);
	});
});
