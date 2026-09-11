// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaID, UserID} from '../../BrandedTypes';

type Nullish<T> = T | null;

export interface PersonaRow {
	user_id: UserID;
	persona_id: PersonaID;
	name: string;
	avatar_url: Nullish<string>;
	system_name: Nullish<string>;
	pronouns: Nullish<string>;
	color: Nullish<number>;
	bio: Nullish<string>;
	auto_tag_disabled: boolean;
	persona_tags: Nullish<string>;
	use_count: number;
	last_used_at_ms: Nullish<bigint>;
	visibility: string;
	external_uuid: Nullish<string>;
	created_at: Date;
	updated_at: Date;
	version: number;
}

export const PERSONA_COLUMNS = [
	'user_id',
	'persona_id',
	'name',
	'avatar_url',
	'system_name',
	'pronouns',
	'color',
	'bio',
	'auto_tag_disabled',
	'persona_tags',
	'use_count',
	'last_used_at_ms',
	'visibility',
	'external_uuid',
	'created_at',
	'updated_at',
	'version',
] as const;
