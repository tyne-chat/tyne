// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaVisibility} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import type {PersonaID, UserID} from '../BrandedTypes';
import type {UserPersonaSettingsRow} from '../database/types/PersonaTypes';
import type {Persona} from '../models/Persona';

export interface CreatePersonaParams {
	user_id: UserID;
	persona_id?: PersonaID;
	name: string;
	avatar_url?: string | null;
	banner_url?: string | null;
	system_name?: string | null;
	pronouns?: string | null;
	color?: number | null;
	avatar_color?: number | null;
	bio?: string | null;
	auto_tag_disabled?: boolean;
	persona_tags?: Array<PersonaTag>;
	visibility?: PersonaVisibility;
	external_uuid?: string | null;
	use_count?: number;
	last_used_at_ms?: bigint | null;
}

export interface UpdatePersonaParams {
	name?: string;
	avatar_url?: string | null;
	banner_url?: string | null;
	system_name?: string | null;
	pronouns?: string | null;
	color?: number | null;
	avatar_color?: number | null;
	bio?: string | null;
	auto_tag_disabled?: boolean;
	persona_tags?: Array<PersonaTag>;
	visibility?: PersonaVisibility;
	external_uuid?: string | null;
	use_count?: number;
	last_used_at_ms?: bigint | null;
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
	abstract deleteAllByUserId(userId: UserID): Promise<void>;
	abstract findSettings(userId: UserID): Promise<UserPersonaSettingsRow | null>;
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
