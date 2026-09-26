// SPDX-License-Identifier: AGPL-3.0-or-later

import {generateSnowflake} from '@fluxer/snowflake/src/Snowflake';
import {createPersonaID, type PersonaID, type UserID} from '../BrandedTypes';
import {fetchMany, fetchOne, upsertOne} from '../database/CassandraQueryExecution';
import type {PersonaRow, UserPersonaSettingsRow} from '../database/types/PersonaTypes';
import {Persona} from '../models/Persona';
import {Personas, UserPersonaSettings} from '../Tables';
import {type CreatePersonaParams, IPersonaRepository, type UpdatePersonaParams} from './IPersonaRepository';

const FETCH_PERSONA_CQL = Personas.selectCql({
	where: [Personas.where.eq('user_id'), Personas.where.eq('persona_id')],
	limit: 1,
});

const FETCH_PERSONAS_BY_USER_CQL = Personas.selectCql({
	where: Personas.where.eq('user_id'),
});

const FETCH_PERSONAS_BY_USER_IDS_CQL = Personas.selectCql({
	where: Personas.where.in('user_id', 'user_ids'),
});

const FETCH_SETTINGS_CQL = UserPersonaSettings.selectCql({
	where: [UserPersonaSettings.where.eq('user_id')],
	limit: 1,
});

const FETCH_SETTINGS_BY_USER_IDS_CQL = UserPersonaSettings.selectCql({
	where: UserPersonaSettings.where.in('user_id', 'user_ids'),
});

export class PersonaRepository extends IPersonaRepository {
	async findById(userId: UserID, personaId: PersonaID, options?: {includeDeleted?: boolean}): Promise<Persona | null> {
		const row = await fetchOne<PersonaRow>(FETCH_PERSONA_CQL, {
			user_id: userId,
			persona_id: personaId,
		});
		if (!row) return null;
		const persona = new Persona(row);
		if (!options?.includeDeleted && persona.isDeleted) {
			return null;
		}
		return persona;
	}

	async findByUserId(userId: UserID, options?: {includeDeleted?: boolean}): Promise<Array<Persona>> {
		const rows = await fetchMany<PersonaRow>(FETCH_PERSONAS_BY_USER_CQL, {
			user_id: userId,
		});
		const personas = rows.map((r) => new Persona(r));
		if (options?.includeDeleted) {
			return personas;
		}
		return personas.filter((p) => !p.isDeleted);
	}

	async findByUserIds(userIds: Array<UserID>, options?: {includeDeleted?: boolean}): Promise<Array<Persona>> {
		if (!userIds || userIds.length === 0) return [];
		const chunkSize = 100;
		const results: Array<Persona> = [];
		for (let i = 0; i < userIds.length; i += chunkSize) {
			const chunk = userIds.slice(i, i + chunkSize);
			const rows = await fetchMany<PersonaRow>(FETCH_PERSONAS_BY_USER_IDS_CQL, {
				user_ids: chunk,
			});
			for (const r of rows) {
				const persona = new Persona(r);
				if (options?.includeDeleted || !persona.isDeleted) {
					results.push(persona);
				}
			}
		}
		return results;
	}

	async findByUserAndPersonaIds(pairs: Array<{userId: UserID; personaId: PersonaID}>): Promise<Map<string, Persona>> {
		if (!pairs || pairs.length === 0) return new Map();
		const uniquePairs = new Map<string, {userId: UserID; personaId: PersonaID}>();
		for (const pair of pairs) {
			uniquePairs.set(`${pair.userId.toString()}:${pair.personaId.toString()}`, pair);
		}
		const results = new Map<string, Persona>();
		const entries = Array.from(uniquePairs.values());
		const chunkSize = 50;
		for (let i = 0; i < entries.length; i += chunkSize) {
			const chunk = entries.slice(i, i + chunkSize);
			const fetched = await Promise.all(
				chunk.map(async ({userId, personaId}) => {
					const row = await fetchOne<PersonaRow>(FETCH_PERSONA_CQL, {
						user_id: userId,
						persona_id: personaId,
					});
					return row ? new Persona(row) : null;
				}),
			);
			for (const p of fetched) {
				if (p) {
					results.set(p.id.toString(), p);
				}
			}
		}
		return results;
	}

	async count(userId: UserID): Promise<number> {
		const active = await this.findByUserId(userId);
		return active.length;
	}

	async create(params: CreatePersonaParams): Promise<Persona> {
		const now = new Date();
		const personaId = params.persona_id ?? createPersonaID(generateSnowflake());
		const row: PersonaRow = {
			user_id: params.user_id,
			persona_id: personaId,
			name: params.name,
			avatar_url: params.avatar_url ?? null,
			banner_url: params.banner_url ?? null,
			system_name: params.system_name ?? null,
			pronouns: params.pronouns ?? null,
			color: params.color ?? null,
			avatar_color: params.avatar_color ?? null,
			bio: params.bio ?? null,
			auto_tag_disabled: params.auto_tag_disabled ?? false,
			persona_tags: params.persona_tags ? JSON.stringify(params.persona_tags) : JSON.stringify([]),
			use_count: params.use_count ?? 0,
			last_used_at_ms: params.last_used_at_ms ?? null,
			visibility: params.visibility ?? 'unlisted',
			external_uuid: params.external_uuid ?? null,
			created_at: now,
			updated_at: now,
			version: 1,
		};
		await upsertOne(Personas.upsertAll(row));
		return new Persona(row);
	}

	async update(userId: UserID, personaId: PersonaID, params: UpdatePersonaParams): Promise<Persona | null> {
		const existing = await this.findById(userId, personaId);
		if (!existing) return null;

		const now = new Date();
		const row: PersonaRow = {
			user_id: userId,
			persona_id: personaId,
			name: params.name !== undefined ? params.name : existing.name,
			avatar_url: params.avatar_url !== undefined ? params.avatar_url : existing.avatarUrl,
			banner_url: params.banner_url !== undefined ? params.banner_url : existing.bannerUrl,
			system_name: params.system_name !== undefined ? params.system_name : existing.systemName,
			pronouns: params.pronouns !== undefined ? params.pronouns : existing.pronouns,
			color: params.color !== undefined ? params.color : existing.color,
			avatar_color: params.avatar_color !== undefined ? params.avatar_color : existing.avatarColor,
			bio: params.bio !== undefined ? params.bio : existing.bio,
			auto_tag_disabled: params.auto_tag_disabled !== undefined ? params.auto_tag_disabled : existing.autoTagDisabled,
			persona_tags:
				params.persona_tags !== undefined ? JSON.stringify(params.persona_tags) : JSON.stringify(existing.personaTags),
			use_count: params.use_count !== undefined ? params.use_count : existing.useCount,
			last_used_at_ms: params.last_used_at_ms !== undefined ? params.last_used_at_ms : existing.lastUsedAtMs,
			visibility: params.visibility !== undefined ? params.visibility : existing.visibility,
			external_uuid: params.external_uuid !== undefined ? params.external_uuid : existing.externalUuid,
			created_at: existing.createdAt,
			updated_at: now,
			version: existing.version + 1,
		};
		await upsertOne(Personas.upsertAll(row));
		return new Persona(row);
	}

	async delete(userId: UserID, personaId: PersonaID): Promise<boolean> {
		const existing = await this.findById(userId, personaId);
		if (!existing || existing.isDeleted) return false;
		const now = new Date();
		const row = existing.toRow();
		row.deleted_at = now;
		row.updated_at = now;
		row.version = existing.version + 1;
		await upsertOne(Personas.upsertAll(row));
		return true;
	}

	async deleteAllByUserId(userId: UserID): Promise<void> {
		const personas = await this.findByUserId(userId);
		const now = new Date();
		await Promise.all(
			personas.map(async (p) => {
				const row = p.toRow();
				row.deleted_at = now;
				row.updated_at = now;
				row.version = p.version + 1;
				await upsertOne(Personas.upsertAll(row));
			}),
		);
	}

	async findSettings(userId: UserID): Promise<UserPersonaSettingsRow | null> {
		const row = await fetchOne<UserPersonaSettingsRow>(FETCH_SETTINGS_CQL, {
			user_id: userId,
		});
		return row ?? null;
	}

	override async findSettingsByUserIds(userIds: Array<UserID>): Promise<Map<string, UserPersonaSettingsRow>> {
		if (!userIds || userIds.length === 0) return new Map();
		const chunkSize = 100;
		const results = new Map<string, UserPersonaSettingsRow>();
		for (let i = 0; i < userIds.length; i += chunkSize) {
			const chunk = userIds.slice(i, i + chunkSize);
			const rows = await fetchMany<UserPersonaSettingsRow>(FETCH_SETTINGS_BY_USER_IDS_CQL, {
				user_ids: chunk,
			});
			for (const r of rows) {
				results.set(r.user_id.toString(), r);
			}
		}
		return results;
	}

	async upsertSettings(row: UserPersonaSettingsRow): Promise<UserPersonaSettingsRow> {
		await upsertOne(UserPersonaSettings.upsertAll(row));
		return row;
	}

	async recordUsage(userId: UserID, personaId: PersonaID): Promise<void> {
		const existing = await this.findById(userId, personaId);
		if (!existing || existing.isDeleted) return;
		const now = new Date();
		const row: PersonaRow = {
			user_id: userId,
			persona_id: personaId,
			name: existing.name,
			avatar_url: existing.avatarUrl,
			banner_url: existing.bannerUrl,
			system_name: existing.systemName,
			pronouns: existing.pronouns,
			color: existing.color,
			bio: existing.bio,
			auto_tag_disabled: existing.autoTagDisabled,
			persona_tags: JSON.stringify(existing.personaTags),
			use_count: existing.useCount + 1,
			last_used_at_ms: BigInt(Date.now()),
			visibility: existing.visibility,
			external_uuid: existing.externalUuid,
			created_at: existing.createdAt,
			updated_at: now,
			version: existing.version + 1,
		};
		await upsertOne(Personas.upsertAll(row));
	}
}
