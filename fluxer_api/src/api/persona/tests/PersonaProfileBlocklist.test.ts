// SPDX-License-Identifier: AGPL-3.0-or-later

import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {UserFlags} from '@fluxer/constants/src/UserConstants';
import {ContentBlockedError} from '@fluxer/errors/src/domains/content/ContentBlockedError';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createTestAccount} from '../../auth/tests/AuthTestUtils';
import type {PersonaID, UserID} from '../../BrandedTypes';
import type {PersonaRow} from '../../database/types/PersonaTypes';
import {profileSubstringBlocklistCache} from '../../middleware/ProfileSubstringBlocklistCache';
import {Persona} from '../../models/Persona';
import type {User} from '../../models/User';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';
import type {UserAccountLookupService} from '../../user/services/UserAccountLookupService';
import type {IPersonaRepository} from '../IPersonaRepository';
import {PersonaService} from '../PersonaService';

const SCOPES = ['global_name', 'bio', 'pronouns'] as const;
const BANNED = 'blockedslug';

const userId = 1000000000000000001n as UserID;
const personaId = 2000000000000000001n as PersonaID;

function makePersona(options: Partial<PersonaRow> = {}): Persona {
	return new Persona({
		user_id: userId,
		persona_id: personaId,
		name: 'Alice',
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
		visibility: 'unlisted',
		external_uuid: null,
		created_at: new Date('2026-01-01T00:00:00Z'),
		updated_at: new Date('2026-01-01T00:00:00Z'),
		version: 1,
		...options,
	});
}

function banEverywhere(): void {
	for (const scope of SCOPES) profileSubstringBlocklistCache.add(scope, BANNED);
}

afterEach(() => {
	for (const scope of SCOPES) profileSubstringBlocklistCache.remove(scope, BANNED);
});

describe('PersonaService and the admin profile blocklist', () => {
	let repo: IPersonaRepository;
	let findUnique: ReturnType<typeof vi.fn>;
	let service: PersonaService;

	beforeEach(() => {
		repo = {
			count: vi.fn().mockResolvedValue(0),
			findById: vi.fn().mockResolvedValue(makePersona()),
			findByUserId: vi.fn().mockResolvedValue([]),
			findByUserIds: vi.fn().mockResolvedValue([]),
			findByUserAndPersonaIds: vi.fn().mockResolvedValue(new Map()),
			findSettings: vi.fn().mockResolvedValue(null),
			findSettingsByUserIds: vi.fn().mockResolvedValue(new Map()),
			upsertSettings: vi.fn().mockResolvedValue(undefined),
			recordUsage: vi.fn().mockResolvedValue(undefined),
			create: vi.fn().mockImplementation(async (row: Partial<PersonaRow>) => makePersona({name: row.name})),
			update: vi.fn().mockImplementation(async () => makePersona()),
			delete: vi.fn(),
			deleteAllByUserId: vi.fn(),
			hardDeleteAllByUserId: vi.fn(),
			createTombstone: vi.fn(),
			deleteSettings: vi.fn(),
		};
		findUnique = vi.fn().mockResolvedValue({flags: 0n} as Pick<User, 'flags'>);
		service = new PersonaService({
			personaRepository: repo,
			userAccountLookupService: {findUnique} as unknown as UserAccountLookupService,
		});
	});

	it.each([
		['name', {name: `My ${BANNED} persona`}],
		['bio', {name: 'Alice', bio: `about ${BANNED}`}],
		['pronouns', {name: 'Alice', pronouns: `${BANNED}/they`}],
	])('refuses a new persona with a banned substring in its %s', async (_field, data) => {
		banEverywhere();

		await expect(service.createPersona(userId, data)).rejects.toThrow(ContentBlockedError);
		expect(repo.create).not.toHaveBeenCalled();
	});

	it('creates a persona without banned text, and does not look up the account', async () => {
		banEverywhere();

		await service.createPersona(userId, {name: 'Alice', bio: 'hello', pronouns: 'she/her'});

		expect(repo.create).toHaveBeenCalledTimes(1);
		expect(findUnique).not.toHaveBeenCalled();
	});

	it('lets an account exempt from the profile blocklist use banned text', async () => {
		banEverywhere();
		findUnique.mockResolvedValue({flags: UserFlags.STAFF});

		await service.createPersona(userId, {name: `My ${BANNED} persona`});

		expect(repo.create).toHaveBeenCalledTimes(1);
	});

	it('refuses an edit that puts banned text in a persona', async () => {
		banEverywhere();

		await expect(service.updatePersona(userId, personaId, {name: BANNED})).rejects.toThrow(ContentBlockedError);
		expect(repo.update).not.toHaveBeenCalled();
	});

	it('allows editing a persona whose stored name was banned later, when the name is not changed', async () => {
		vi.mocked(repo.findById).mockResolvedValue(makePersona({name: `Old ${BANNED}`}));
		banEverywhere();

		await service.updatePersona(userId, personaId, {name: `Old ${BANNED}`, color: 0x123456});

		expect(repo.update).toHaveBeenCalledTimes(1);
	});

	it('refuses an import with banned text before writing any persona', async () => {
		banEverywhere();

		await expect(
			service.importPersonas(userId, [{name: 'Fine'}, {name: 'Also fine', bio: `bio ${BANNED}`}]),
		).rejects.toThrow(ContentBlockedError);
		expect(repo.create).not.toHaveBeenCalled();
		expect(repo.update).not.toHaveBeenCalled();
	});

	it('refuses a display tag with banned text, and keeps an unchanged one', async () => {
		banEverywhere();

		await expect(service.updateSettings(userId, {display_tag_text: `${BANNED} system`})).rejects.toThrow(
			ContentBlockedError,
		);
		expect(repo.upsertSettings).not.toHaveBeenCalled();

		vi.mocked(repo.findSettings).mockResolvedValue({
			user_id: userId,
			active_persona_mode: 'manual',
			active_persona_scope: 'global',
			active_persona_id: null,
			is_latched: false,
			display_tag_text: `${BANNED} system`,
			display_tag_icon: null,
			updated_at: new Date('2026-01-01T00:00:00Z'),
			version: 1,
		});
		await service.updateSettings(userId, {display_tag_text: `${BANNED} system`, is_latched: true});
		expect(repo.upsertSettings).toHaveBeenCalledTimes(1);
	});
});

describe('Persona routes and the admin profile blocklist', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});

	it('answers CONTENT_BLOCKED for a persona named with banned text', async () => {
		const account = await createTestAccount(harness);
		banEverywhere();

		await createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({name: `My ${BANNED} persona`})
			.expect(HTTP_STATUS.FORBIDDEN, APIErrorCodes.CONTENT_BLOCKED)
			.execute();
	});
});
