// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaID, UserID} from '../../BrandedTypes';

type Nullish<T> = T | null;

export interface PersonaRow {
	user_id: UserID;
	persona_id: PersonaID;
	name: string;
	avatar_url: Nullish<string>;
	banner_url: Nullish<string>;
	system_name: Nullish<string>;
	pronouns: Nullish<string>;
	color: Nullish<number>;
	avatar_color: Nullish<number>;
	bio: Nullish<string>;
	auto_tag_disabled: boolean;
	persona_tags: Nullish<string>;
	use_count: number;
	last_used_at_ms: Nullish<bigint>;
	visibility: string;
	external_uuid: Nullish<string>;
	created_at: Date;
	updated_at: Date;
	deleted_at?: Nullish<Date>;
	version: number;
}

export const PERSONA_COLUMNS = [
	'user_id',
	'persona_id',
	'name',
	'avatar_url',
	'banner_url',
	'system_name',
	'pronouns',
	'color',
	'avatar_color',
	'bio',
	'auto_tag_disabled',
	'persona_tags',
	'use_count',
	'last_used_at_ms',
	'visibility',
	'external_uuid',
	'created_at',
	'updated_at',
	'deleted_at',
	'version',
] as const;

export interface UserPersonaSettingsRow {
	user_id: UserID;
	active_persona_mode: string;
	active_persona_id: Nullish<string>;
	is_latched: boolean;
	display_tag_text: Nullish<string>;
	display_tag_icon: Nullish<string>;
	updated_at: Date;
	version: number;
}

export const USER_PERSONA_SETTINGS_COLUMNS = [
	'user_id',
	'active_persona_mode',
	'active_persona_id',
	'is_latched',
	'display_tag_text',
	'display_tag_icon',
	'updated_at',
	'version',
] as const satisfies ReadonlyArray<keyof UserPersonaSettingsRow>;
