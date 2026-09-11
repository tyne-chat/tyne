// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaVisibility} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import type {PersonaID, UserID} from '../BrandedTypes';
import type {Persona} from '../models/Persona';

export interface CreatePersonaParams {
	user_id: UserID;
	persona_id?: PersonaID;
	name: string;
	avatar_url?: string | null;
	system_name?: string | null;
	pronouns?: string | null;
	color?: number | null;
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
	system_name?: string | null;
	pronouns?: string | null;
	color?: number | null;
	bio?: string | null;
	auto_tag_disabled?: boolean;
	persona_tags?: Array<PersonaTag>;
	visibility?: PersonaVisibility;
	external_uuid?: string | null;
	use_count?: number;
	last_used_at_ms?: bigint | null;
}

export abstract class IPersonaRepository {
	abstract findById(userId: UserID, personaId: PersonaID): Promise<Persona | null>;
	abstract findByUserId(userId: UserID): Promise<Array<Persona>>;
	abstract count(userId: UserID): Promise<number>;
	abstract create(params: CreatePersonaParams): Promise<Persona>;
	abstract update(userId: UserID, personaId: PersonaID, params: UpdatePersonaParams): Promise<Persona | null>;
	abstract delete(userId: UserID, personaId: PersonaID): Promise<boolean>;
	abstract deleteAllByUserId(userId: UserID): Promise<void>;
}
