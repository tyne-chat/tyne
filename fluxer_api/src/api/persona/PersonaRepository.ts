// SPDX-License-Identifier: AGPL-3.0-or-later

import {generateSnowflake} from '@fluxer/snowflake/src/Snowflake';
import {createPersonaID, type PersonaID, type UserID} from '../BrandedTypes';
import {fetchMany, fetchOne, upsertOne} from '../database/CassandraQueryExecution';
import type {PersonaRow} from '../database/types/PersonaTypes';
import {Persona} from '../models/Persona';
import {Personas} from '../Tables';
import {type CreatePersonaParams, IPersonaRepository, type UpdatePersonaParams} from './IPersonaRepository';

const FETCH_PERSONA_CQL = Personas.selectCql({
	where: [Personas.where.eq('user_id'), Personas.where.eq('persona_id')],
	limit: 1,
});

const FETCH_PERSONAS_BY_USER_CQL = Personas.selectCql({
	where: Personas.where.eq('user_id'),
});

const COUNT_PERSONAS_CQL = Personas.selectCountCql({
	where: Personas.where.eq('user_id'),
});

export class PersonaRepository extends IPersonaRepository {
	async findById(userId: UserID, personaId: PersonaID): Promise<Persona | null> {
		const row = await fetchOne<PersonaRow>(FETCH_PERSONA_CQL, {
			user_id: userId,
			persona_id: personaId,
		});
		return row ? new Persona(row) : null;
	}

	async findByUserId(userId: UserID): Promise<Array<Persona>> {
		const rows = await fetchMany<PersonaRow>(FETCH_PERSONAS_BY_USER_CQL, {
			user_id: userId,
		});
		return rows.map((r) => new Persona(r));
	}

	async count(userId: UserID): Promise<number> {
		const result = await fetchOne<{count: bigint}>(COUNT_PERSONAS_CQL, {
			user_id: userId,
		});
		return result ? Number(result.count) : 0;
	}

	async create(params: CreatePersonaParams): Promise<Persona> {
		const now = new Date();
		const personaId = params.persona_id ?? createPersonaID(generateSnowflake());
		const row: PersonaRow = {
			user_id: params.user_id,
			persona_id: personaId,
			name: params.name,
			avatar_url: params.avatar_url ?? null,
			system_name: params.system_name ?? null,
			pronouns: params.pronouns ?? null,
			color: params.color ?? null,
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
			system_name: params.system_name !== undefined ? params.system_name : existing.systemName,
			pronouns: params.pronouns !== undefined ? params.pronouns : existing.pronouns,
			color: params.color !== undefined ? params.color : existing.color,
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
		if (!existing) return false;
		await fetchOne(Personas.deleteByPk({user_id: userId, persona_id: personaId}));
		return true;
	}

	async deleteAllByUserId(userId: UserID): Promise<void> {
		await fetchOne(Personas.deletePartition({user_id: userId}));
	}
}
