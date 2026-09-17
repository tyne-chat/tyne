// SPDX-License-Identifier: AGPL-3.0-or-later

import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {PersonaID, UserID} from '../../BrandedTypes';
import type {PersonaRow} from '../../database/types/PersonaTypes';
import {Persona} from '../../models/Persona';
import {
	DuplicatePersonaTagError,
	PersonaLimitReachedError,
	PersonaNotFoundError,
	PersonaTagLimitExceededError,
} from '../errors/PersonaErrors';
import type {IPersonaRepository} from '../IPersonaRepository';
import {MAX_PERSONAS_PER_USER, PersonaService} from '../PersonaService';

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
		avatar_url: null,
		system_name: null,
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
			findSettings: vi.fn().mockResolvedValue(null),
			upsertSettings: vi.fn().mockResolvedValue(undefined as any),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			deleteAllByUserId: vi.fn(),
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
});
