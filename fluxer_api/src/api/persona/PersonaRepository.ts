// SPDX-License-Identifier: AGPL-3.0-or-later

import {personaAssetHashOrNull} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaID, UserID} from '../BrandedTypes';
import {BatchBuilder, deleteOneOrMany, fetchMany, fetchOne, upsertOne} from '../database/CassandraQueryExecution';
import type {PersonaRow, UserPersonaSettingsRow} from '../database/types/PersonaTypes';
import {Persona} from '../models/Persona';
import {Personas, UserPersonaSettings} from '../Tables';
import {
	type CreatePersonaParams,
	IPersonaRepository,
	type PersonaImportWrite,
	personaLookupKey,
	type UpdatePersonaParams,
} from './IPersonaRepository';
import {generatePersonaId} from './PersonaIdGenerator';

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

// Settings rows written before `active_persona_scope` existed do not have it. They mean what they
// always meant, one persona for every channel, and a row has to carry every column to be written
// back whole. The tag icon is the hash of an image stored under the account; the route accepts
// nothing else, the rows written before it checked were migrated once, and anything else read
// here (a restored backup, say) is dropped rather than handed to apps that would load it.
function normalizeSettingsRow(row: UserPersonaSettingsRow): UserPersonaSettingsRow {
	return {
		...row,
		active_persona_scope: row.active_persona_scope === 'channel' ? 'channel' : 'global',
		display_tag_icon: personaAssetHashOrNull(row.display_tag_icon),
	};
}

function createdPersonaRow(params: CreatePersonaParams, personaId: PersonaID, now: Date): PersonaRow {
	return {
		user_id: params.user_id,
		persona_id: personaId,
		name: params.name,
		avatar_hash: params.avatar_hash ?? null,
		banner_hash: params.banner_hash ?? null,
		pronouns: params.pronouns ?? null,
		color: params.color ?? null,
		avatar_color: params.avatar_color ?? null,
		bio: params.bio ?? null,
		auto_tag_disabled: params.auto_tag_disabled ?? false,
		persona_tags: params.persona_tags ? JSON.stringify(params.persona_tags) : JSON.stringify([]),
		signature_emojis: params.signature_emojis ? JSON.stringify(params.signature_emojis) : JSON.stringify([]),
		use_count: params.use_count ?? 0,
		last_used_at_ms: params.last_used_at_ms ?? null,
		visibility: params.visibility ?? 'unlisted',
		external_uuid: params.external_uuid ?? null,
		created_at: now,
		updated_at: now,
		version: 1,
	};
}

function updatedPersonaRow(existing: Persona, params: UpdatePersonaParams, now: Date): PersonaRow {
	return {
		user_id: existing.userId,
		persona_id: existing.id,
		name: params.name !== undefined ? params.name : existing.name,
		avatar_hash: params.avatar_hash !== undefined ? params.avatar_hash : existing.avatarHash,
		banner_hash: params.banner_hash !== undefined ? params.banner_hash : existing.bannerHash,
		pronouns: params.pronouns !== undefined ? params.pronouns : existing.pronouns,
		color: params.color !== undefined ? params.color : existing.color,
		avatar_color: params.avatar_color !== undefined ? params.avatar_color : existing.avatarColor,
		bio: params.bio !== undefined ? params.bio : existing.bio,
		auto_tag_disabled: params.auto_tag_disabled !== undefined ? params.auto_tag_disabled : existing.autoTagDisabled,
		persona_tags:
			params.persona_tags !== undefined ? JSON.stringify(params.persona_tags) : JSON.stringify(existing.personaTags),
		signature_emojis:
			params.signature_emojis !== undefined
				? JSON.stringify(params.signature_emojis)
				: JSON.stringify(existing.signatureEmojis),
		use_count: params.use_count !== undefined ? params.use_count : existing.useCount,
		last_used_at_ms: params.last_used_at_ms !== undefined ? params.last_used_at_ms : existing.lastUsedAtMs,
		visibility: params.visibility !== undefined ? params.visibility : existing.visibility,
		external_uuid: params.external_uuid !== undefined ? params.external_uuid : existing.externalUuid,
		created_at: existing.createdAt,
		updated_at: now,
		version: existing.version + 1,
	};
}

// Deletion is soft: the row stays, so old messages keep showing the persona.
function deletedPersonaRow(existing: Persona, now: Date): PersonaRow {
	const row = existing.toRow();
	row.deleted_at = now;
	row.updated_at = now;
	row.version = existing.version + 1;
	return row;
}

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
			uniquePairs.set(personaLookupKey(pair.userId, pair.personaId), pair);
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
					return row ? {key: personaLookupKey(userId, personaId), persona: new Persona(row)} : null;
				}),
			);
			for (const entry of fetched) {
				if (entry) {
					results.set(entry.key, entry.persona);
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
		const row = createdPersonaRow(params, params.persona_id ?? (await generatePersonaId()), new Date());
		await upsertOne(Personas.upsertAll(row));
		return new Persona(row);
	}

	async update(userId: UserID, personaId: PersonaID, params: UpdatePersonaParams): Promise<Persona | null> {
		const existing = await this.findById(userId, personaId);
		if (!existing) return null;

		const row = updatedPersonaRow(existing, params, new Date());
		await upsertOne(Personas.upsertAll(row));
		return new Persona(row);
	}

	async delete(userId: UserID, personaId: PersonaID): Promise<boolean> {
		const existing = await this.findById(userId, personaId);
		if (!existing || existing.isDeleted) return false;
		await upsertOne(Personas.upsertAll(deletedPersonaRow(existing, new Date())));
		return true;
	}

	async writeImport(userId: UserID, write: PersonaImportWrite): Promise<Array<Persona>> {
		const now = new Date();
		const rows: Array<PersonaRow> = [];
		for (const step of write.steps) {
			if ('create' in step) {
				rows.push(
					createdPersonaRow(
						{...step.create, user_id: userId},
						step.create.persona_id ?? (await generatePersonaId()),
						now,
					),
				);
			} else if ('restore' in step) {
				rows.push({...updatedPersonaRow(step.restore, step.params, now), deleted_at: null});
			} else {
				rows.push(updatedPersonaRow(step.update, step.params, now));
			}
		}
		const written = rows.map((row) => new Persona(row));

		const batch = new BatchBuilder();
		for (const persona of write.retire) batch.addPrepared(Personas.upsertAll(deletedPersonaRow(persona, now)));
		for (const row of rows) batch.addPrepared(Personas.upsertAll(row));
		if (write.settings) batch.addPrepared(UserPersonaSettings.upsertAll(write.settings));
		for (const query of write.alongside?.(written) ?? []) batch.addPrepared(query);
		await batch.execute();
		return written;
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

	async hardDeleteAllByUserId(userId: UserID): Promise<void> {
		const personas = await this.findByUserId(userId, {includeDeleted: true});
		await Promise.all(
			personas.map(async (p) => {
				await deleteOneOrMany(
					Personas.deleteByPk({
						user_id: userId,
						persona_id: p.id,
					}),
				);
			}),
		);
	}

	async createTombstone(userId: UserID, personaId: PersonaID): Promise<Persona> {
		const now = new Date();
		const row: PersonaRow = {
			user_id: userId,
			persona_id: personaId,
			name: 'Deleted Persona',
			avatar_hash: null,
			banner_hash: null,
			pronouns: null,
			color: null,
			avatar_color: null,
			bio: null,
			auto_tag_disabled: true,
			persona_tags: JSON.stringify([]),
			use_count: 0,
			last_used_at_ms: null,
			visibility: 'unlisted',
			external_uuid: null,
			created_at: now,
			updated_at: now,
			deleted_at: now,
			version: 1,
		};
		await upsertOne(Personas.upsertAll(row));
		return new Persona(row);
	}

	async findSettings(userId: UserID): Promise<UserPersonaSettingsRow | null> {
		const row = await fetchOne<UserPersonaSettingsRow>(FETCH_SETTINGS_CQL, {
			user_id: userId,
		});
		return row ? normalizeSettingsRow(row) : null;
	}

	async deleteSettings(userId: UserID): Promise<void> {
		await deleteOneOrMany(
			UserPersonaSettings.deleteByPk({
				user_id: userId,
			}),
		);
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
				results.set(r.user_id.toString(), normalizeSettingsRow(r));
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
			avatar_hash: existing.avatarHash,
			banner_hash: existing.bannerHash,
			pronouns: existing.pronouns,
			color: existing.color,
			avatar_color: existing.avatarColor,
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
