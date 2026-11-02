// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaVisibility, SignatureEmoji} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import type {PersonaID, UserID} from '../BrandedTypes';
import type {PreparedQuery} from '../database/CassandraTypes';
import type {UserPersonaSettingsRow} from '../database/types/PersonaTypes';
import type {Persona} from '../models/Persona';

export interface CreatePersonaParams {
	user_id: UserID;
	persona_id?: PersonaID;
	name: string;
	avatar_hash?: string | null;
	banner_hash?: string | null;
	pronouns?: string | null;
	color?: number | null;
	avatar_color?: number | null;
	bio?: string | null;
	auto_tag_disabled?: boolean;
	persona_tags?: Array<PersonaTag>;
	signature_emojis?: Array<SignatureEmoji>;
	visibility?: PersonaVisibility;
	external_uuid?: string | null;
	use_count?: number;
	last_used_at_ms?: bigint | null;
}

export interface UpdatePersonaParams {
	name?: string;
	avatar_hash?: string | null;
	banner_hash?: string | null;
	pronouns?: string | null;
	color?: number | null;
	avatar_color?: number | null;
	bio?: string | null;
	auto_tag_disabled?: boolean;
	persona_tags?: Array<PersonaTag>;
	signature_emojis?: Array<SignatureEmoji>;
	visibility?: PersonaVisibility;
	external_uuid?: string | null;
	use_count?: number;
	last_used_at_ms?: bigint | null;
}

/** What an import does to one persona it brings in: make a new one, or update the one it matched. */
export type PersonaImportStep = {create: CreatePersonaParams} | {update: Persona; params: UpdatePersonaParams};

export interface PersonaImportWrite {
	/** Live personas the import replaces. They are soft-deleted, as `delete` does. */
	retire: ReadonlyArray<Persona>;
	/** One step per persona the import brings in, in order. */
	steps: ReadonlyArray<PersonaImportStep>;
	/** The account's persona settings as they are after the import, when the import changes them. */
	settings?: UserPersonaSettingsRow;
	/** Writes to other persona tables that go with these, built from the personas as written. */
	alongside?: (written: ReadonlyArray<Persona>) => ReadonlyArray<PreparedQuery>;
}

export function personaLookupKey(userId: UserID | string, personaId: PersonaID | string): string {
	return `${userId.toString()}:${personaId.toString()}`;
}

export abstract class IPersonaRepository {
	abstract findById(
		userId: UserID,
		personaId: PersonaID,
		options?: {includeDeleted?: boolean},
	): Promise<Persona | null>;
	abstract findByUserId(userId: UserID, options?: {includeDeleted?: boolean}): Promise<Array<Persona>>;
	abstract findByUserIds(userIds: Array<UserID>, options?: {includeDeleted?: boolean}): Promise<Array<Persona>>;
	abstract findByUserAndPersonaIds(pairs: Array<{userId: UserID; personaId: PersonaID}>): Promise<Map<string, Persona>>;
	abstract count(userId: UserID): Promise<number>;
	abstract create(params: CreatePersonaParams): Promise<Persona>;
	abstract update(userId: UserID, personaId: PersonaID, params: UpdatePersonaParams): Promise<Persona | null>;
	abstract delete(userId: UserID, personaId: PersonaID): Promise<boolean>;
	/**
	 * Writes an import as one atomic batch, so either all of it is stored or none of it. Returns the
	 * personas the steps wrote, in the steps' order.
	 */
	abstract writeImport(userId: UserID, write: PersonaImportWrite): Promise<Array<Persona>>;
	abstract deleteAllByUserId(userId: UserID): Promise<void>;
	abstract hardDeleteAllByUserId(userId: UserID): Promise<void>;
	abstract createTombstone(userId: UserID, personaId: PersonaID): Promise<Persona>;
	abstract findSettings(userId: UserID): Promise<UserPersonaSettingsRow | null>;
	abstract deleteSettings(userId: UserID): Promise<void>;
	async findSettingsByUserIds(userIds: Array<UserID>): Promise<Map<string, UserPersonaSettingsRow>> {
		const results = new Map<string, UserPersonaSettingsRow>();
		await Promise.all(
			userIds.map(async (uid) => {
				const s = await this.findSettings(uid);
				if (s) results.set(uid.toString(), s);
			}),
		);
		return results;
	}
	abstract upsertSettings(row: UserPersonaSettingsRow): Promise<UserPersonaSettingsRow>;
	abstract recordUsage(userId: UserID, personaId: PersonaID): Promise<void>;
}
