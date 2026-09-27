// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {createPersonaID, createUserID, type UserID} from '../../BrandedTypes';
import type {UserPersonaSettingsRow} from '../../database/types/PersonaTypes';
import {Persona} from '../../models/Persona';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {IPersonaRepository} from '../IPersonaRepository';
import {PersonaRepository} from '../PersonaRepository';

describe('PersonaRepository', () => {
	let harness: ApiTestHarness;
	let repo: PersonaRepository;

	const userA = createUserID(9001n);
	const userB = createUserID(9002n);

	beforeAll(async () => {
		harness = await createApiTestHarness();
		repo = new PersonaRepository();
	});

	beforeEach(async () => {
		await harness.reset();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	it('creates and finds personas by id, user id, and batch user ids', async () => {
		const created1 = await repo.create({
			user_id: userA,
			name: 'Fox Persona',
			visibility: 'public',
			persona_tags: [{prefix: '[f]', suffix: '[/f]'}],
		});

		expect(created1.name).toBe('Fox Persona');
		expect(created1.userId).toBe(userA);
		expect(created1.personaTags).toEqual([{prefix: '[f]', suffix: '[/f]'}]);

		await repo.create({
			user_id: userA,
			name: 'Wolf Persona',
			visibility: 'unlisted',
		});

		const createdB = await repo.create({
			user_id: userB,
			name: 'Bear Persona',
			visibility: 'private',
		});

		// findById
		const found = await repo.findById(userA, created1.id);
		expect(found).toBeDefined();
		expect(found?.name).toBe('Fox Persona');

		// count
		const userACount = await repo.count(userA);
		expect(userACount).toBe(2);

		// findByUserId
		const userAPersonas = await repo.findByUserId(userA);
		expect(userAPersonas.map((p) => p.name)).toEqual(expect.arrayContaining(['Fox Persona', 'Wolf Persona']));

		// findByUserIds
		const batchPersonas = await repo.findByUserIds([userA, userB]);
		expect(batchPersonas.map((p) => p.name)).toEqual(
			expect.arrayContaining(['Fox Persona', 'Wolf Persona', 'Bear Persona']),
		);

		// findByUserAndPersonaIds
		const pairsMap = await repo.findByUserAndPersonaIds([
			{userId: userA, personaId: created1.id},
			{userId: userB, personaId: createdB.id},
		]);
		expect(pairsMap.size).toBe(2);
		expect(pairsMap.get(created1.id.toString())?.name).toBe('Fox Persona');
		expect(pairsMap.get(createdB.id.toString())?.name).toBe('Bear Persona');
	});

	it('updates persona fields and increments version', async () => {
		const persona = await repo.create({
			user_id: userA,
			name: 'Initial Name',
			bio: 'Initial Bio',
		});

		const updated = await repo.update(userA, persona.id, {
			name: 'Updated Name',
			bio: 'Updated Bio',
			color: 0x123456,
		});

		expect(updated).toBeDefined();
		expect(updated?.name).toBe('Updated Name');
		expect(updated?.bio).toBe('Updated Bio');
		expect(updated?.color).toBe(0x123456);
		expect(updated?.version).toBe(persona.version + 1);

		// Non-existent update returns null
		const nonExistent = await repo.update(userA, createPersonaID(999999n), {name: 'Nope'});
		expect(nonExistent).toBeNull();
	});

	it('records usage with use_count increment and timestamp update', async () => {
		const persona = await repo.create({
			user_id: userA,
			name: 'Used Persona',
		});
		expect(persona.useCount).toBe(0);
		expect(persona.lastUsedAtMs).toBeNull();

		await repo.recordUsage(userA, persona.id);

		const refreshed = await repo.findById(userA, persona.id);
		expect(refreshed?.useCount).toBe(1);
		expect(refreshed?.lastUsedAtMs).not.toBeNull();
		expect(Number(refreshed?.lastUsedAtMs)).toBeGreaterThan(0);
	});

	it('creates tombstone for deleted persona', async () => {
		const targetPersonaId = createPersonaID(777888n);
		const tombstone = await repo.createTombstone(userA, targetPersonaId);

		expect(tombstone.id).toBe(targetPersonaId);
		expect(tombstone.name).toBe('Deleted Persona');
		expect(tombstone.isDeleted).toBe(true);

		// verify findById with includeDeleted finds it
		const found = await repo.findById(userA, targetPersonaId, {includeDeleted: true});
		expect(found?.isDeleted).toBe(true);

		// standard findById filters it
		const filtered = await repo.findById(userA, targetPersonaId);
		expect(filtered).toBeNull();
	});

	it('manages persona settings and batch settings queries', async () => {
		const settingsA = await repo.upsertSettings({
			user_id: userA,
			active_persona_id: null,
			active_persona_mode: 'manual',
			is_latched: false,
			display_tag_text: 'System Alpha',
			display_tag_icon: null,
			updated_at: new Date(),
			version: 1,
		});

		expect(settingsA.display_tag_text).toBe('System Alpha');

		const fetchedA = await repo.findSettings(userA);
		expect(fetchedA?.display_tag_text).toBe('System Alpha');

		await repo.upsertSettings({
			user_id: userB,
			active_persona_id: null,
			active_persona_mode: 'last',
			is_latched: true,
			display_tag_text: 'System Beta',
			display_tag_icon: null,
			updated_at: new Date(),
			version: 1,
		});

		// Batch fetch settings
		const batchSettings = await repo.findSettingsByUserIds([userA, userB]);
		expect(batchSettings.size).toBe(2);
		expect(batchSettings.get(userA.toString())?.display_tag_text).toBe('System Alpha');
		expect(batchSettings.get(userB.toString())?.display_tag_text).toBe('System Beta');

		// Delete settings
		await repo.deleteSettings(userA);
		const afterDelete = await repo.findSettings(userA);
		expect(afterDelete).toBeNull();
	});

	it('handles soft-delete and hard-delete operations', async () => {
		const p1 = await repo.create({user_id: userA, name: 'P1'});
		await repo.create({user_id: userA, name: 'P2'});

		// Soft delete single
		const deleted = await repo.delete(userA, p1.id);
		expect(deleted).toBe(true);

		const active = await repo.findByUserId(userA);
		expect(active.map((p) => p.name)).toEqual(['P2']);

		const all = await repo.findByUserId(userA, {includeDeleted: true});
		expect(all.map((p) => p.name)).toEqual(expect.arrayContaining(['P1', 'P2']));

		// deleteAllByUserId
		await repo.deleteAllByUserId(userA);
		const activeAfterAll = await repo.findByUserId(userA);
		expect(activeAfterAll).toHaveLength(0);

		// hardDeleteAllByUserId
		await repo.hardDeleteAllByUserId(userA);
		const totalAfterHard = await repo.findByUserId(userA, {includeDeleted: true});
		expect(totalAfterHard).toHaveLength(0);
	});

	it('handles empty and null query guards and non-existent delete/usage', async () => {
		// Empty array guards
		expect(await repo.findByUserIds([])).toEqual([]);
		expect(await repo.findByUserIds(null as any)).toEqual([]);
		expect(await repo.findByUserAndPersonaIds([])).toEqual(new Map());
		expect(await repo.findByUserAndPersonaIds(null as any)).toEqual(new Map());
		expect(await repo.findSettingsByUserIds([])).toEqual(new Map());
		expect(await repo.findSettingsByUserIds(null as any)).toEqual(new Map());

		// Deleting non-existent persona returns false
		const nonExistentId = createPersonaID(999999n);
		expect(await repo.delete(userA, nonExistentId)).toBe(false);

		// Record usage on non-existent persona completes without error
		await expect(repo.recordUsage(userA, nonExistentId)).resolves.toBeUndefined();
	});

	it('tests default IPersonaRepository.findSettingsByUserIds fallback implementation', async () => {
		class DefaultRepo extends IPersonaRepository {
			async findById(): Promise<any> {
				return null;
			}
			async count(): Promise<number> {
				return 0;
			}
			async findByUserId(): Promise<Array<any>> {
				return [];
			}
			async findByUserIds(): Promise<Array<any>> {
				return [];
			}
			async findByUserAndPersonaIds(): Promise<Map<string, any>> {
				return new Map();
			}
			async create(): Promise<any> {
				return {} as any;
			}
			async update(): Promise<any> {
				return null;
			}
			async delete(): Promise<boolean> {
				return false;
			}
			async deleteAllByUserId(): Promise<void> {}
			async hardDeleteAllByUserId(): Promise<void> {}
			async createTombstone(): Promise<any> {
				return {} as any;
			}
			async findSettings(userId: UserID): Promise<UserPersonaSettingsRow | null> {
				if (userId === userA) {
					return {
						user_id: userA,
						active_persona_id: null,
						active_persona_mode: 'manual',
						is_latched: false,
						display_tag_text: 'tag',
						display_tag_icon: null,
						updated_at: new Date(),
						version: 1,
					};
				}
				return null;
			}
			async deleteSettings(): Promise<void> {}
			async upsertSettings(row: UserPersonaSettingsRow): Promise<UserPersonaSettingsRow> {
				return row;
			}
			async recordUsage(): Promise<void> {}
		}

		const defaultRepo = new DefaultRepo();
		const results = await defaultRepo.findSettingsByUserIds([userA, userB]);
		expect(results.size).toBe(1);
		expect(results.get(userA.toString())?.display_tag_text).toBe('tag');
	});

	it('tests Persona model tag parsing fallback branches', () => {
		const p1 = new Persona({
			user_id: userA,
			persona_id: createPersonaID(123n),
			name: 'Test',
			persona_tags: null,
		} as any);
		expect(p1.personaTags).toEqual([]);

		const p2 = new Persona({
			user_id: userA,
			persona_id: createPersonaID(124n),
			name: 'Test2',
			persona_tags: 'not-json',
		} as any);
		expect(p2.personaTags).toEqual([]);

		const p3 = new Persona({
			user_id: userA,
			persona_id: createPersonaID(125n),
			name: 'Test3',
			persona_tags: '{"not": "array"}',
		} as any);
		expect(p3.personaTags).toEqual([]);
	});
});
