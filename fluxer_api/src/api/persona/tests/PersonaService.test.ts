// SPDX-License-Identifier: AGPL-3.0-or-later

import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {PersonaID, UserID} from '../../BrandedTypes';
import type {PersonaRow} from '../../database/types/PersonaTypes';
import {Persona} from '../../models/Persona';
import {
	DuplicatePersonaTagError,
	DuplicateSignatureEmojiError,
	PersonaLimitReachedError,
	PersonaNotFoundError,
	PersonaTagLimitExceededError,
	SignatureEmojiLimitExceededError,
} from '../errors/PersonaErrors';
import type {IPersonaRepository} from '../IPersonaRepository';
import {
	calculatePersonaFrecencyScore,
	calculatePersonaMatchScore,
	MAX_PERSONAS_PER_USER,
	PersonaService,
} from '../PersonaService';

function makeMockPersona(
	userId: UserID,
	personaId: PersonaID,
	name: string,
	options: Partial<PersonaRow> = {},
): Persona {
	const row: PersonaRow = {
		user_id: userId,
		persona_id: personaId,
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
		visibility: 'unlisted',
		external_uuid: null,
		created_at: new Date('2026-01-01T00:00:00Z'),
		updated_at: new Date('2026-01-01T00:00:00Z'),
		version: 1,
		...options,
	};
	return new Persona(row);
}

describe('PersonaService', () => {
	let mockRepo: IPersonaRepository;
	let service: PersonaService;
	const userId = 1000000000000000001n as UserID;
	const defaultPersonaId = 2000000000000000001n as PersonaID;

	beforeEach(() => {
		mockRepo = {
			count: vi.fn().mockResolvedValue(0),
			findById: vi.fn().mockResolvedValue(null),
			findByUserId: vi.fn().mockResolvedValue([]),
			findByUserIds: vi.fn().mockResolvedValue([]),
			findByUserAndPersonaIds: vi.fn().mockResolvedValue(new Map()),
			findSettings: vi.fn().mockResolvedValue(null),
			findSettingsByUserIds: vi.fn().mockResolvedValue(new Map()),
			upsertSettings: vi.fn().mockResolvedValue(undefined as any),
			recordUsage: vi.fn().mockResolvedValue(undefined),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			deleteAllByUserId: vi.fn(),
			hardDeleteAllByUserId: vi.fn(),
			createTombstone: vi.fn(),
			deleteSettings: vi.fn(),
		};
		service = new PersonaService({personaRepository: mockRepo});
	});

	describe('getPersona', () => {
		it('returns persona when found', async () => {
			const persona = makeMockPersona(userId, defaultPersonaId, 'Alice');
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(persona);

			const result = await service.getPersona(userId, defaultPersonaId);
			expect(result).toBe(persona);
			expect(mockRepo.findById).toHaveBeenCalledWith(userId, defaultPersonaId);
		});

		it('throws PersonaNotFoundError when persona does not exist', async () => {
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(null);

			await expect(service.getPersona(userId, defaultPersonaId)).rejects.toThrow(PersonaNotFoundError);
		});
	});

	describe('createPersona', () => {
		// Enforces the account ceiling of 250 personas (MAX_PERSONAS_PER_USER) to prevent
		// database bloat and excessive lookup overhead.
		it('throws PersonaLimitReachedError when user has reached MAX_PERSONAS_PER_USER', async () => {
			vi.mocked(mockRepo.count).mockResolvedValueOnce(MAX_PERSONAS_PER_USER);

			await expect(service.createPersona(userId, {name: 'Over Limit'})).rejects.toThrow(PersonaLimitReachedError);
		});

		// Enforces the maximum limit of 5 persona tag pairs per persona to keep matcher iteration lightweight.
		it('throws PersonaTagLimitExceededError when more than 5 tags are provided', async () => {
			vi.mocked(mockRepo.count).mockResolvedValueOnce(0);

			const tags = [{prefix: '1:'}, {prefix: '2:'}, {prefix: '3:'}, {prefix: '4:'}, {prefix: '5:'}, {prefix: '6:'}];

			await expect(service.createPersona(userId, {name: 'Too Many Tags', persona_tags: tags})).rejects.toThrow(
				PersonaTagLimitExceededError,
			);
		});

		// Intra-persona duplicate check: prevents assigning the same prefix and suffix pair multiple times
		// to the same persona.
		it('throws DuplicatePersonaTagError when same tag is listed multiple times on the same persona', async () => {
			vi.mocked(mockRepo.count).mockResolvedValueOnce(0);

			const tags = [{prefix: 'dup:'}, {prefix: 'dup:'}];

			await expect(service.createPersona(userId, {name: 'Duplicate Tag', persona_tags: tags})).rejects.toThrow(
				DuplicatePersonaTagError,
			);
		});

		// Inter-persona collision check: prevents two different personas of the same user from sharing
		// identical prefix/suffix tags, ensuring unambiguous in-chat persona matching.
		it('throws DuplicatePersonaTagError when tag is already in use by another persona of the user', async () => {
			vi.mocked(mockRepo.count).mockResolvedValueOnce(1);
			const existingPersona = makeMockPersona(userId, defaultPersonaId, 'Existing', {
				persona_tags: JSON.stringify([{prefix: 'taken:'}]),
			});
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([existingPersona]);

			await expect(
				service.createPersona(userId, {name: 'Colliding Tag', persona_tags: [{prefix: 'taken:'}]}),
			).rejects.toThrow(DuplicatePersonaTagError);
		});
	});

	describe('updatePersona', () => {
		it('throws PersonaNotFoundError when persona to update does not exist', async () => {
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(null);

			await expect(service.updatePersona(userId, defaultPersonaId, {name: 'New Name'})).rejects.toThrow(
				PersonaNotFoundError,
			);
		});

		it('throws PersonaTagLimitExceededError when updated tags exceed 5', async () => {
			const existing = makeMockPersona(userId, defaultPersonaId, 'Alice');
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(existing);

			const tags = [{prefix: '1:'}, {prefix: '2:'}, {prefix: '3:'}, {prefix: '4:'}, {prefix: '5:'}, {prefix: '6:'}];

			await expect(service.updatePersona(userId, defaultPersonaId, {persona_tags: tags})).rejects.toThrow(
				PersonaTagLimitExceededError,
			);
		});
	});

	describe('importPersonas', () => {
		// Validates tag limits and prevents duplicate tag assignments across batch PluralKit/Tupperbox imports.
		it('throws PersonaTagLimitExceededError if an imported persona has more than 5 tags', async () => {
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([]);

			const toImport = [
				{
					name: 'Tag Spammer',
					persona_tags: [
						{prefix: '1:'},
						{prefix: '2:'},
						{prefix: '3:'},
						{prefix: '4:'},
						{prefix: '5:'},
						{prefix: '6:'},
					],
				},
			];

			await expect(service.importPersonas(userId, toImport)).rejects.toThrow(PersonaTagLimitExceededError);
		});

		it('throws DuplicatePersonaTagError if a single imported persona contains duplicate tags', async () => {
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([]);

			const toImport = [
				{
					name: 'Duplicate Inside',
					persona_tags: [{prefix: 'tag:'}, {prefix: 'tag:'}],
				},
			];

			await expect(service.importPersonas(userId, toImport)).rejects.toThrow(DuplicatePersonaTagError);
		});

		it('throws DuplicatePersonaTagError if imported personas conflict with each other', async () => {
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([]);

			const toImport = [
				{name: 'Persona 1', persona_tags: [{prefix: 'shared:'}]},
				{name: 'Persona 2', persona_tags: [{prefix: 'shared:'}]},
			];

			await expect(service.importPersonas(userId, toImport)).rejects.toThrow(DuplicatePersonaTagError);
		});

		// Verifies that bulk imports cannot push the user's total persona count past the 250 limit.
		it('throws PersonaLimitReachedError during import when exceeding MAX_PERSONAS_PER_USER', async () => {
			const existingPersonas = Array.from({length: MAX_PERSONAS_PER_USER}, (_, i) =>
				makeMockPersona(userId, (2000000000000000000n + BigInt(i)) as PersonaID, `Persona ${i}`),
			);
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce(existingPersonas);

			const toImport = [{name: 'One Too Many'}];

			await expect(service.importPersonas(userId, toImport)).rejects.toThrow(PersonaLimitReachedError);
		});
	});

	describe('getPublicPersonaById', () => {
		const viewerId = 3000000000000000001n as UserID;
		const otherViewerId = 4000000000000000001n as UserID;

		it('throws PersonaNotFoundError when public persona does not exist', async () => {
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(null);

			await expect(service.getPublicPersonaById(viewerId, userId, defaultPersonaId)).rejects.toThrow(
				PersonaNotFoundError,
			);
		});

		// Privacy enforcement: Private personas return 404 (NotFound) rather than 403 (Forbidden)
		// to prevent unauthorized users from discovering or enumerating the existence of private personas.
		it('throws PersonaNotFoundError when persona is private and viewer is not the owner', async () => {
			const privatePersona = makeMockPersona(userId, defaultPersonaId, 'Secret', {
				visibility: 'private',
			});
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(privatePersona);

			await expect(service.getPublicPersonaById(otherViewerId, userId, defaultPersonaId)).rejects.toThrow(
				PersonaNotFoundError,
			);
		});

		// The persona owner is always permitted to view their own private persona's representation.
		it('returns public response when persona is private but viewer is owner', async () => {
			const privatePersona = makeMockPersona(userId, defaultPersonaId, 'Secret', {
				visibility: 'private',
			});
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(privatePersona);

			const result = await service.getPublicPersonaById(userId, userId, defaultPersonaId);
			expect(result.id).toBe('2000000000000000001');
			expect(result.name).toBe('Secret');
			expect(result.visibility).toBe('private');
		});
	});

	describe('getChannelPersonaMentions', () => {
		const otherUserId = 3000000000000000001n as UserID;
		const userMap = new Map([
			[userId, {username: 'alice_owner', globalName: 'Alice Global', nickname: 'Ali'}],
			[otherUserId, {username: 'bob_owner', globalName: 'Bob Global', nickname: 'Bobby'}],
		]);

		it('returns empty array when candidateUserIds is empty', async () => {
			const results = await service.getChannelPersonaMentions({
				callerUserId: userId,
				candidateUserIds: [],
				query: 'alice',
				userMap,
			});
			expect(results).toEqual([]);
			expect(mockRepo.findByUserIds).not.toHaveBeenCalled();
		});

		it('allows caller to see their own non-public personas and other users public and unlisted personas, but filters private', async () => {
			const myUnlisted = makeMockPersona(userId, 1n as PersonaID, 'My Unlisted', {visibility: 'unlisted'});
			const otherPublic = makeMockPersona(otherUserId, 2n as PersonaID, 'Other Public', {visibility: 'public'});
			const otherUnlisted = makeMockPersona(otherUserId, 3n as PersonaID, 'Other Unlisted', {visibility: 'unlisted'});
			const otherPrivate = makeMockPersona(otherUserId, 4n as PersonaID, 'Other Private', {visibility: 'private'});

			vi.mocked(mockRepo.findByUserIds).mockResolvedValueOnce([myUnlisted, otherPublic, otherUnlisted, otherPrivate]);

			const results = await service.getChannelPersonaMentions({
				callerUserId: userId,
				candidateUserIds: [userId, otherUserId],
				userMap,
			});

			const names = results.map((r) => r.name);
			expect(names).toContain('My Unlisted');
			expect(names).toContain('Other Public');
			expect(names).toContain('Other Unlisted');
			expect(names).not.toContain('Other Private');
		});

		it('sorts prefix matches ahead of substring matches and sorts by useCount on ties', async () => {
			const substringMatch = makeMockPersona(otherUserId, 10n as PersonaID, 'The Cat Alice', {
				visibility: 'public',
				use_count: 50,
			});
			const prefixLowUse = makeMockPersona(otherUserId, 11n as PersonaID, 'Alice Early', {
				visibility: 'public',
				use_count: 1,
			});
			const prefixHighUse = makeMockPersona(otherUserId, 12n as PersonaID, 'Alice Prime', {
				visibility: 'public',
				use_count: 100,
			});

			vi.mocked(mockRepo.findByUserIds).mockResolvedValueOnce([substringMatch, prefixLowUse, prefixHighUse]);

			const results = await service.getChannelPersonaMentions({
				callerUserId: userId,
				candidateUserIds: [otherUserId],
				query: 'ali',
				userMap,
			});

			expect(results.map((r) => r.name)).toEqual(['Alice Prime', 'Alice Early', 'The Cat Alice']);
		});

		it('boosts recently active personas ahead of older personas with higher usage counts', async () => {
			const now = Date.now();
			const olderFrequent = makeMockPersona(otherUserId, 15n as PersonaID, 'Bob Old', {
				visibility: 'public',
				use_count: 500,
				last_used_at_ms: BigInt(now - 14 * 24 * 60 * 60 * 1000), // 14 days ago
			});
			const recentRare = makeMockPersona(otherUserId, 16n as PersonaID, 'Bob Recent', {
				visibility: 'public',
				use_count: 2,
				last_used_at_ms: BigInt(now - 5 * 60 * 1000), // 5 minutes ago
			});

			vi.mocked(mockRepo.findByUserIds).mockResolvedValueOnce([olderFrequent, recentRare]);

			const results = await service.getChannelPersonaMentions({
				callerUserId: userId,
				candidateUserIds: [otherUserId],
				query: 'bob',
				userMap,
			});

			expect(results.map((r) => r.name)).toEqual(['Bob Recent', 'Bob Old']);
			expect(results[0].use_count).toBe(2);
			expect(results[0].last_used_at_ms).toBeDefined();
		});

		it('matches by owner username, nickname, or display tag', async () => {
			const personaByOwnerNick = makeMockPersona(otherUserId, 20n as PersonaID, 'Shadow', {
				visibility: 'public',
			});
			const personaByTag = makeMockPersona(otherUserId, 21n as PersonaID, 'Ghost', {
				visibility: 'public',
			});

			vi.mocked(mockRepo.findByUserIds).mockResolvedValueOnce([personaByOwnerNick, personaByTag]);
			vi.mocked(mockRepo.findSettingsByUserIds).mockResolvedValueOnce(
				new Map([
					[
						otherUserId.toString(),
						{
							user_id: otherUserId,
							active_persona_id: null,
							active_persona_mode: 'manual',
							active_persona_scope: 'global',
							is_latched: false,
							display_tag_text: 'BobbySystem',
							display_tag_icon: null,
							version: 1,
							updated_at: new Date(),
						},
					],
				]),
			);

			const results = await service.getChannelPersonaMentions({
				callerUserId: userId,
				candidateUserIds: [otherUserId],
				query: 'bobby',
				userMap,
			});

			expect(results).toHaveLength(2);
			expect(results[0].owner_nickname).toBe('Bobby');
		});
	});

	describe('Persona Model', () => {
		// Database resiliency: Ensures that toRow serializes fields properly and that
		// corrupted or non-array JSON stored in legacy persona_tags columns safely falls
		// back to an empty array without crashing the query layer.
		it('handles toRow serialization and malformed tag recovery', () => {
			const persona = makeMockPersona(userId, defaultPersonaId, 'Test Persona', {
				persona_tags: JSON.stringify([{prefix: 't:'}]),
			});
			const row = persona.toRow();
			expect(row.name).toBe('Test Persona');
			expect(row.persona_tags).toBe(JSON.stringify([{prefix: 't:'}]));

			// Malformed non-array JSON tags
			const malformedNonArray = makeMockPersona(userId, 2n as PersonaID, 'P', {persona_tags: '{"not": "array"}'});
			expect(malformedNonArray.personaTags).toEqual([]);

			// Malformed invalid JSON tags
			const malformedInvalidJson = makeMockPersona(userId, 3n as PersonaID, 'P', {persona_tags: '{invalid_json'});
			expect(malformedInvalidJson.personaTags).toEqual([]);
		});
	});

	describe('dispatchToMutualGuilds', () => {
		it('dispatches GUILD_PERSONAS_DIRTY to user mutual guilds on public persona creation and deletion', async () => {
			const mockGateway = {
				dispatchPresence: vi.fn().mockResolvedValue(undefined),
				dispatchGuild: vi.fn().mockResolvedValue(undefined),
			};
			const mockUserGuildRepo = {
				getUserGuildIds: vi.fn().mockResolvedValue([123n, 456n]),
			};
			const serviceWithGuilds = new PersonaService({
				personaRepository: mockRepo,
				gatewayService: mockGateway as any,
				userGuildRepository: mockUserGuildRepo as any,
			});

			const publicPersona = makeMockPersona(userId, defaultPersonaId, 'Alice Public', {visibility: 'public'});
			vi.mocked(mockRepo.count).mockResolvedValueOnce(0);
			vi.mocked(mockRepo.create).mockResolvedValueOnce(publicPersona);

			await serviceWithGuilds.createPersona(userId, {name: 'Alice Public', visibility: 'public'});

			expect(mockGateway.dispatchGuild).toHaveBeenCalledTimes(2);
			expect(mockGateway.dispatchGuild).toHaveBeenCalledWith({
				guildId: 123n,
				event: 'GUILD_PERSONAS_DIRTY',
				data: {
					guild_id: '123',
					user_id: userId.toString(),
					action: 'update',
					display_tag_text: null,
					display_tag_icon: null,
					persona: publicPersona.toSubprofileResponse(),
				},
			});
			expect(mockGateway.dispatchGuild).toHaveBeenCalledWith({
				guildId: 456n,
				event: 'GUILD_PERSONAS_DIRTY',
				data: {
					guild_id: '456',
					user_id: userId.toString(),
					action: 'update',
					display_tag_text: null,
					display_tag_icon: null,
					persona: publicPersona.toSubprofileResponse(),
				},
			});

			mockGateway.dispatchGuild.mockClear();

			// Delete public persona
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(publicPersona);
			vi.mocked(mockRepo.delete).mockResolvedValueOnce(true);

			await serviceWithGuilds.deletePersona(userId, defaultPersonaId);
			expect(mockGateway.dispatchGuild).toHaveBeenCalledTimes(2);
			expect(mockGateway.dispatchGuild).toHaveBeenCalledWith({
				guildId: 123n,
				event: 'GUILD_PERSONAS_DIRTY',
				data: {
					guild_id: '123',
					user_id: userId.toString(),
					action: 'delete',
					display_tag_text: null,
					display_tag_icon: null,
					persona: publicPersona.toSubprofileResponse(),
				},
			});
		});

		it('does NOT dispatch GUILD_PERSONAS_DIRTY for private persona mutations', async () => {
			const mockGateway = {
				dispatchPresence: vi.fn().mockResolvedValue(undefined),
				dispatchGuild: vi.fn().mockResolvedValue(undefined),
			};
			const mockUserGuildRepo = {
				getUserGuildIds: vi.fn().mockResolvedValue([123n]),
			};
			const serviceWithGuilds = new PersonaService({
				personaRepository: mockRepo,
				gatewayService: mockGateway as any,
				userGuildRepository: mockUserGuildRepo as any,
			});

			const privatePersona = makeMockPersona(userId, defaultPersonaId, 'Alice Private', {visibility: 'private'});
			vi.mocked(mockRepo.count).mockResolvedValueOnce(0);
			vi.mocked(mockRepo.create).mockResolvedValueOnce(privatePersona);

			await serviceWithGuilds.createPersona(userId, {name: 'Alice Private', visibility: 'private'});

			expect(mockGateway.dispatchGuild).not.toHaveBeenCalled();
		});

		it('does NOT dispatch GUILD_PERSONAS_DIRTY when active persona or latch settings change', async () => {
			const mockGateway = {
				dispatchPresence: vi.fn().mockResolvedValue(undefined),
				dispatchGuild: vi.fn().mockResolvedValue(undefined),
			};
			const mockUserGuildRepo = {
				getUserGuildIds: vi.fn().mockResolvedValue([123n, 456n]),
			};
			const serviceWithGuilds = new PersonaService({
				personaRepository: mockRepo,
				gatewayService: mockGateway as any,
				userGuildRepository: mockUserGuildRepo as any,
			});

			vi.mocked(mockRepo.findSettings).mockResolvedValueOnce({
				user_id: userId,
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				active_persona_id: null,
				is_latched: false,
				display_tag_text: 'System Tag',
				display_tag_icon: null,
				updated_at: new Date(),
				version: 1,
			});

			await serviceWithGuilds.updateSettings(userId, {
				active_persona_id: defaultPersonaId.toString(),
				is_latched: true,
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
			});

			// Dispatches to user for sync across own tabs/devices
			expect(mockGateway.dispatchPresence).toHaveBeenCalledTimes(1);
			// Mutual guilds are NOT dirtied for private composer switches
			expect(mockGateway.dispatchGuild).not.toHaveBeenCalled();
		});

		it('dispatches GUILD_PERSONAS_DIRTY when display_tag_text or display_tag_icon changes', async () => {
			const mockGateway = {
				dispatchPresence: vi.fn().mockResolvedValue(undefined),
				dispatchGuild: vi.fn().mockResolvedValue(undefined),
			};
			const mockUserGuildRepo = {
				getUserGuildIds: vi.fn().mockResolvedValue([123n, 456n]),
			};
			const serviceWithGuilds = new PersonaService({
				personaRepository: mockRepo,
				gatewayService: mockGateway as any,
				userGuildRepository: mockUserGuildRepo as any,
			});

			vi.mocked(mockRepo.findSettings).mockResolvedValueOnce({
				user_id: userId,
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				active_persona_id: defaultPersonaId.toString(),
				is_latched: true,
				display_tag_text: 'Old Tag',
				display_tag_icon: null,
				updated_at: new Date(),
				version: 1,
			});

			await serviceWithGuilds.updateSettings(userId, {
				display_tag_text: 'New Tag',
			});

			expect(mockGateway.dispatchPresence).toHaveBeenCalledTimes(1);
			expect(mockGateway.dispatchGuild).toHaveBeenCalledTimes(2);
			expect(mockGateway.dispatchGuild).toHaveBeenCalledWith({
				guildId: 123n,
				event: 'GUILD_PERSONAS_DIRTY',
				data: {
					guild_id: '123',
					user_id: userId.toString(),
					action: 'sync',
					display_tag_text: 'New Tag',
					display_tag_icon: null,
				},
			});
			expect(mockGateway.dispatchGuild).toHaveBeenCalledWith({
				guildId: 456n,
				event: 'GUILD_PERSONAS_DIRTY',
				data: {
					guild_id: '456',
					user_id: userId.toString(),
					action: 'sync',
					display_tag_text: 'New Tag',
					display_tag_icon: null,
				},
			});
		});

		it('dispatches GUILD_PERSONAS_DIRTY to DM recipients via dispatchPresence when personas are updated', async () => {
			const mockGateway = {
				dispatchPresence: vi.fn().mockResolvedValue(undefined),
				dispatchGuild: vi.fn().mockResolvedValue(undefined),
			};
			const dmRecipientId1 = 789n;
			const dmRecipientId2 = 999n;
			const mockUserChannelRepo = {
				listPrivateChannels: vi.fn().mockResolvedValue([
					{
						id: 111n,
						recipientIds: new Set([userId, dmRecipientId1]),
					},
					{
						id: 222n,
						recipientIds: new Set([userId, dmRecipientId2]),
					},
				]),
			};
			const serviceWithChannels = new PersonaService({
				personaRepository: mockRepo,
				gatewayService: mockGateway as any,
				userChannelRepository: mockUserChannelRepo as any,
			});

			const existingPersona = makeMockPersona(userId, defaultPersonaId, 'Alice Original');
			const updatedPersona = makeMockPersona(userId, defaultPersonaId, 'Alice Renamed');
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(existingPersona);
			vi.mocked(mockRepo.update).mockResolvedValueOnce(updatedPersona);

			await serviceWithChannels.updatePersona(userId, defaultPersonaId, {name: 'Alice Renamed'});

			// 1 for USER_PERSONA_UPDATE to author, 2 for GUILD_PERSONAS_DIRTY to DM recipients
			expect(mockGateway.dispatchPresence).toHaveBeenCalledTimes(3);
			expect(mockGateway.dispatchPresence).toHaveBeenCalledWith({
				userId: dmRecipientId1,
				event: 'GUILD_PERSONAS_DIRTY',
				data: {
					user_id: userId.toString(),
					action: 'update',
					display_tag_text: null,
					display_tag_icon: null,
					persona: updatedPersona.toSubprofileResponse(),
				},
			});
			expect(mockGateway.dispatchPresence).toHaveBeenCalledWith({
				userId: dmRecipientId2,
				event: 'GUILD_PERSONAS_DIRTY',
				data: {
					user_id: userId.toString(),
					action: 'update',
					display_tag_text: null,
					display_tag_icon: null,
					persona: updatedPersona.toSubprofileResponse(),
				},
			});
		});
	});

	describe('Active Persona Cleanup & Resiliency', () => {
		it('clears active_persona_id in settings and dispatches USER_PERSONA_SETTINGS_UPDATE when active persona is deleted', async () => {
			const mockGateway = {
				dispatchPresence: vi.fn().mockResolvedValue(undefined),
				dispatchGuild: vi.fn().mockResolvedValue(undefined),
			};
			const serviceWithGateway = new PersonaService({
				personaRepository: mockRepo,
				gatewayService: mockGateway as any,
			});

			const persona = makeMockPersona(userId, defaultPersonaId, 'Active Persona');
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(persona);
			vi.mocked(mockRepo.delete).mockResolvedValueOnce(true);
			vi.mocked(mockRepo.findSettings).mockResolvedValueOnce({
				user_id: userId,
				active_persona_id: defaultPersonaId.toString(),
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				is_latched: true,
				display_tag_text: 'TAG',
				display_tag_icon: null,
				updated_at: new Date(),
				version: 1,
			});

			await serviceWithGateway.deletePersona(userId, defaultPersonaId);

			expect(mockRepo.upsertSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					user_id: userId,
					active_persona_id: null,
					is_latched: false,
					display_tag_text: 'TAG',
				}),
			);

			expect(mockGateway.dispatchPresence).toHaveBeenCalledWith({
				userId,
				event: 'USER_PERSONA_SETTINGS_UPDATE',
				data: expect.objectContaining({
					user_id: userId.toString(),
					active_persona_id: null,
					is_latched: false,
					display_tag_text: 'TAG',
				}),
			});
		});

		it('leaves settings unchanged when a non-active persona is deleted', async () => {
			const otherPersonaId = 9999999999999999999n as PersonaID;
			const persona = makeMockPersona(userId, defaultPersonaId, 'Non-Active Persona');
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(persona);
			vi.mocked(mockRepo.delete).mockResolvedValueOnce(true);
			vi.mocked(mockRepo.findSettings).mockResolvedValueOnce({
				user_id: userId,
				active_persona_id: otherPersonaId.toString(),
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				is_latched: true,
				display_tag_text: 'TAG',
				display_tag_icon: null,
				updated_at: new Date(),
				version: 1,
			});

			await service.deletePersona(userId, defaultPersonaId);

			expect(mockRepo.upsertSettings).not.toHaveBeenCalled();
		});

		it('returns null active_persona_id in getSettings when referenced persona does not exist', async () => {
			vi.mocked(mockRepo.findSettings).mockResolvedValueOnce({
				user_id: userId,
				active_persona_id: defaultPersonaId.toString(),
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				is_latched: true,
				display_tag_text: 'TAG',
				display_tag_icon: null,
				updated_at: new Date(),
				version: 1,
			});
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(null);

			const settings = await service.getSettings(userId);
			expect(settings.active_persona_id).toBeNull();
			expect(settings.is_latched).toBe(false);
			expect(settings.display_tag_text).toBe('TAG');
		});

		it('returns null active_persona_id in getSettings when referenced persona is deleted', async () => {
			const deletedPersona = makeMockPersona(userId, defaultPersonaId, 'Deleted', {
				deleted_at: new Date(),
			});
			vi.mocked(mockRepo.findSettings).mockResolvedValueOnce({
				user_id: userId,
				active_persona_id: defaultPersonaId.toString(),
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				is_latched: true,
				display_tag_text: 'TAG',
				display_tag_icon: null,
				updated_at: new Date(),
				version: 1,
			});
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(deletedPersona);

			const settings = await service.getSettings(userId);
			expect(settings.active_persona_id).toBeNull();
			expect(settings.is_latched).toBe(false);
			expect(settings.display_tag_text).toBe('TAG');
		});

		it('handles error in findById gracefully in getSettings by resetting active persona', async () => {
			vi.mocked(mockRepo.findSettings).mockResolvedValueOnce({
				user_id: userId,
				active_persona_id: defaultPersonaId.toString(),
				active_persona_mode: 'manual',
				active_persona_scope: 'global',
				is_latched: true,
				display_tag_text: 'TAG',
				display_tag_icon: null,
				updated_at: new Date(),
				version: 1,
			});
			vi.mocked(mockRepo.findById).mockRejectedValueOnce(new Error('Cassandra timeout'));

			const settings = await service.getSettings(userId);
			expect(settings.active_persona_id).toBeNull();
			expect(settings.is_latched).toBe(false);
		});
	});

	describe('Scoring and Ranking Functions', () => {
		it('calculates frecency score across all recency boost brackets', () => {
			const now = 1000000000000;
			const hour = 3600 * 1000;

			// null or 0 lastUsedAtMs returns countScore only
			const countOnly = calculatePersonaFrecencyScore(10, null, now);
			expect(countOnly).toBeCloseTo(Math.log10(11) * 20, 2);

			// < 0.25h (10m ago) -> +120
			const boost120 = calculatePersonaFrecencyScore(0, now - 10 * 60 * 1000, now);
			expect(boost120).toBe(120);

			// < 1h (30m ago) -> +90
			const boost90 = calculatePersonaFrecencyScore(0, now - 30 * 60 * 1000, now);
			expect(boost90).toBe(90);

			// < 24h (5h ago) -> +60
			const boost60 = calculatePersonaFrecencyScore(0, now - 5 * hour, now);
			expect(boost60).toBe(60);

			// < 72h (48h ago) -> +35
			const boost35 = calculatePersonaFrecencyScore(0, now - 48 * hour, now);
			expect(boost35).toBe(35);

			// < 168h (100h ago) -> +15
			const boost15 = calculatePersonaFrecencyScore(0, now - 100 * hour, now);
			expect(boost15).toBe(15);

			// < 720h (300h ago) -> +5
			const boost5 = calculatePersonaFrecencyScore(0, now - 300 * hour, now);
			expect(boost5).toBe(5);

			// >= 720h (800h ago) -> +0
			const boost0 = calculatePersonaFrecencyScore(0, now - 800 * hour, now);
			expect(boost0).toBe(0);
		});

		it('calculates persona match score with exact tiers', () => {
			expect(calculatePersonaMatchScore('Alice', '')).toBe(0);
			expect(calculatePersonaMatchScore('Alice', '   ')).toBe(0);

			// Name prefix -> 1000
			expect(calculatePersonaMatchScore('Alice', 'al')).toBe(1000);

			// Word break in name -> 800
			expect(calculatePersonaMatchScore('Bob-The-Fox', 'the')).toBe(800);
			expect(calculatePersonaMatchScore('Bob The Fox', 'fox')).toBe(800);
			expect(calculatePersonaMatchScore('Bob_The_Fox', 'fox')).toBe(800);

			// Name substring -> 500
			expect(calculatePersonaMatchScore('Alice', 'lic')).toBe(500);

			// Tag prefix -> 350
			expect(calculatePersonaMatchScore('Alice', 'sys', 'System Tag')).toBe(350);

			// Tag substring -> 250
			expect(calculatePersonaMatchScore('Alice', 'tem', 'System Tag')).toBe(250);

			// Owner prefix -> 150
			expect(calculatePersonaMatchScore('Persona', 'bob', null, 'BobUsername')).toBe(150);
			expect(calculatePersonaMatchScore('Persona', 'bob', null, null, 'BobbyNickname')).toBe(150);
			expect(calculatePersonaMatchScore('Persona', 'bob', null, null, null, 'BobGlobal')).toBe(150);

			// Owner substring -> 100
			expect(calculatePersonaMatchScore('Persona', 'use', null, 'BobUsername')).toBe(100);
			expect(calculatePersonaMatchScore('Persona', 'ick', null, null, 'BobbyNickname')).toBe(100);
			expect(calculatePersonaMatchScore('Persona', 'lob', null, null, null, 'BobGlobal')).toBe(100);

			// No match -> -1
			expect(calculatePersonaMatchScore('Alice', 'zebra')).toBe(-1);
		});

		it('rejects importPersonas when a tag conflicts with an existing persona', async () => {
			const existing = makeMockPersona(userId, defaultPersonaId, 'Existing Fox', {
				persona_tags: JSON.stringify([{prefix: '[f]', suffix: '[/f]'}]),
			});
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([existing]);

			await expect(
				service.importPersonas(userId, [
					{
						name: 'New Wolf',
						persona_tags: [{prefix: '[f]', suffix: '[/f]'}],
					},
				]),
			).rejects.toThrow(DuplicatePersonaTagError);
		});

		it('ignores blank prefix and suffix tags in importPersonas', async () => {
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([]);
			const created = makeMockPersona(userId, defaultPersonaId, 'Blank Tags');
			vi.mocked(mockRepo.create).mockResolvedValueOnce(created);

			const results = await service.importPersonas(userId, [
				{
					name: 'Blank Tags',
					persona_tags: [{prefix: '', suffix: ''}],
				},
			]);
			expect(results).toHaveLength(1);
		});

		it('throws PersonaNotFoundError when updatePersona repository update returns null', async () => {
			const existing = makeMockPersona(userId, defaultPersonaId, 'Old');
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(existing);
			vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([existing]);
			vi.mocked(mockRepo.update).mockResolvedValueOnce(null);

			await expect(service.updatePersona(userId, defaultPersonaId, {name: 'New'})).rejects.toThrow(
				PersonaNotFoundError,
			);
		});

		it('throws PersonaNotFoundError when deletePersona repository delete returns false', async () => {
			const existing = makeMockPersona(userId, defaultPersonaId, 'Existing');
			vi.mocked(mockRepo.findById).mockResolvedValueOnce(existing);
			vi.mocked(mockRepo.delete).mockResolvedValueOnce(false);

			await expect(service.deletePersona(userId, defaultPersonaId)).rejects.toThrow(PersonaNotFoundError);
		});

		it('skips validation when persona_tags is empty array or undefined and skips blank tags on other personas', async () => {
			const existing = makeMockPersona(userId, defaultPersonaId, 'My Persona');
			const otherWithBlankTag = makeMockPersona(userId, (defaultPersonaId + 1n) as PersonaID, 'Other Persona', {
				persona_tags: JSON.stringify([{prefix: '', suffix: ''}]),
			});
			vi.mocked(mockRepo.findById).mockResolvedValue(existing);
			vi.mocked(mockRepo.findByUserId).mockResolvedValue([existing, otherWithBlankTag]);
			vi.mocked(mockRepo.update).mockImplementation(async (_u: any, _p: any, params: any) =>
				makeMockPersona(userId, defaultPersonaId, params.name ?? 'My Persona', {
					persona_tags: params.persona_tags ? JSON.stringify(params.persona_tags) : '[]',
				}),
			);

			// 1. Update with empty tags array (hits line 135)
			const resEmpty = await service.updatePersona(userId, defaultPersonaId, {persona_tags: []});
			expect(resEmpty).toBeDefined();

			// 2. Update with valid tag while other persona has blank tag (hits line 163)
			const resWithTag = await service.updatePersona(userId, defaultPersonaId, {
				persona_tags: [{prefix: '[test]', suffix: '[/test]'}],
			});
			expect(resWithTag).toBeDefined();
		});

		describe('signature_emojis validation', () => {
			it('creates and updates persona with valid signature emojis', async () => {
				vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([]);
				const persona = makeMockPersona(userId, defaultPersonaId, 'Emoji Persona', {
					signature_emojis: JSON.stringify([{name: '🦊'}, {id: '123456789', name: 'custom_fox'}]),
				});
				vi.mocked(mockRepo.create).mockResolvedValueOnce(persona);

				const created = await service.createPersona(userId, {
					name: 'Emoji Persona',
					signature_emojis: [{name: '🦊'}, {id: '123456789', name: 'custom_fox'}],
				});
				expect(created).toBeDefined();

				// Update signature emojis
				vi.mocked(mockRepo.findById).mockResolvedValueOnce(persona);
				vi.mocked(mockRepo.findByUserId).mockResolvedValueOnce([persona]);
				vi.mocked(mockRepo.update).mockResolvedValueOnce(persona);

				const updated = await service.updatePersona(userId, defaultPersonaId, {
					signature_emojis: [{name: '🦊'}],
				});
				expect(updated).toBeDefined();
			});

			it('rejects duplicate signature emojis within the same request', async () => {
				await expect(
					service.createPersona(userId, {
						name: 'Dupes',
						signature_emojis: [{name: '🦊'}, {name: '🦊'}],
					}),
				).rejects.toThrow(DuplicateSignatureEmojiError);

				await expect(
					service.createPersona(userId, {
						name: 'Dupes Custom',
						signature_emojis: [
							{id: '123', name: 'custom'},
							{id: '123', name: 'custom'},
						],
					}),
				).rejects.toThrow(DuplicateSignatureEmojiError);
			});

			it('rejects signature emojis that collide with another persona owned by the same user', async () => {
				const existingOther = makeMockPersona(userId, (defaultPersonaId + 1n) as PersonaID, 'Existing Persona', {
					signature_emojis: JSON.stringify([{name: '🦊'}, {id: '999', name: 'cat'}]),
				});
				vi.mocked(mockRepo.findByUserId).mockResolvedValue([existingOther]);

				await expect(
					service.createPersona(userId, {
						name: 'Colliding',
						signature_emojis: [{name: '🦊'}],
					}),
				).rejects.toThrow(DuplicateSignatureEmojiError);

				await expect(
					service.createPersona(userId, {
						name: 'Colliding Custom',
						signature_emojis: [{id: '999', name: 'cat'}],
					}),
				).rejects.toThrow(DuplicateSignatureEmojiError);
			});

			it('allows a persona to keep its own signature emojis during update', async () => {
				const selfPersona = makeMockPersona(userId, defaultPersonaId, 'Self Persona', {
					signature_emojis: JSON.stringify([{name: '🦊'}]),
				});
				vi.mocked(mockRepo.findById).mockResolvedValue(selfPersona);
				vi.mocked(mockRepo.findByUserId).mockResolvedValue([selfPersona]);
				vi.mocked(mockRepo.update).mockResolvedValue(selfPersona);

				const updated = await service.updatePersona(userId, defaultPersonaId, {
					signature_emojis: [{name: '🦊'}, {name: '🐺'}],
				});
				expect(updated).toBeDefined();
			});

			it('rejects signature emojis exceeding the maximum limit', async () => {
				const tooMany = Array.from({length: 10001}, (_, i) => ({
					name: `e${i}`,
				}));
				await expect(
					service.createPersona(userId, {
						name: 'Too Many',
						signature_emojis: tooMany,
					}),
				).rejects.toThrow(SignatureEmojiLimitExceededError);
			});
		});
	});
});
