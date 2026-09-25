// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	PersonaResponse,
	PersonaVisibility,
	PublicPersonaResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {snowflakeToDate} from '@fluxer/snowflake/src/Snowflake';
import type {PersonaID, UserID} from '../BrandedTypes';
import type {PersonaRow} from '../database/types/PersonaTypes';

export class Persona {
	readonly id: PersonaID;
	readonly userId: UserID;
	readonly name: string;
	readonly avatarUrl: string | null;
	readonly bannerUrl: string | null;
	readonly systemName: string | null;
	readonly pronouns: string | null;
	readonly color: number | null;
	readonly avatarColor: number | null;
	readonly bio: string | null;
	readonly autoTagDisabled: boolean;
	readonly personaTags: Array<PersonaTag>;
	readonly useCount: number;
	readonly lastUsedAtMs: bigint | null;
	readonly visibility: PersonaVisibility;
	readonly externalUuid: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly deletedAt: Date | null;
	readonly version: number;

	get isDeleted(): boolean {
		return this.deletedAt !== null;
	}

	constructor(row: PersonaRow) {
		this.id = row.persona_id;
		this.userId = row.user_id;
		this.name = row.name;
		this.avatarUrl = row.avatar_url ?? null;
		this.bannerUrl = row.banner_url ?? null;
		this.systemName = row.system_name ?? null;
		this.pronouns = row.pronouns ?? null;
		this.color = row.color ?? null;
		this.avatarColor = row.avatar_color ?? null;
		this.bio = row.bio ?? null;
		this.autoTagDisabled = row.auto_tag_disabled ?? false;
		this.personaTags = parsePersonaTags(row.persona_tags);
		this.useCount = row.use_count ?? 0;
		this.lastUsedAtMs = row.last_used_at_ms ?? null;
		this.visibility = (row.visibility as PersonaVisibility) || 'unlisted';
		this.externalUuid = row.external_uuid ?? null;
		this.createdAt = row.created_at ?? snowflakeToDate(row.persona_id);
		this.updatedAt = row.updated_at ?? this.createdAt;
		this.deletedAt = row.deleted_at ?? null;
		this.version = row.version ?? 1;
	}

	toResponse(): PersonaResponse {
		return {
			id: this.id.toString(),
			name: this.name,
			avatar_url: this.avatarUrl,
			banner_url: this.bannerUrl,
			system_name: this.systemName,
			pronouns: this.pronouns,
			color: this.color,
			avatar_color: this.avatarColor,
			bio: this.bio,
			auto_tag_disabled: this.autoTagDisabled,
			persona_tags: this.personaTags,
			use_count: this.useCount,
			last_used_at_ms: this.lastUsedAtMs ? this.lastUsedAtMs.toString() : null,
			visibility: this.visibility,
			external_uuid: this.externalUuid,
			created_at: this.createdAt.toISOString(),
			updated_at: this.updatedAt.toISOString(),
			deleted_at: this.deletedAt ? this.deletedAt.toISOString() : null,
		};
	}

	toPublicResponse(): PublicPersonaResponse {
		return {
			id: this.id.toString(),
			name: this.name,
			avatar_url: this.avatarUrl,
			banner_url: this.bannerUrl,
			system_name: this.systemName,
			pronouns: this.pronouns,
			color: this.color,
			avatar_color: this.avatarColor,
			bio: this.bio,
			visibility: this.visibility,
		};
	}

	toSubprofileResponse(): {
		id: string;
		name: string;
		avatar: string | null;
		avatar_color: number | null;
		banner?: string | null;
		display_tag_text?: string | null;
		display_tag_icon?: string | null;
		system_name?: string | null;
		pronouns: string | null;
		color: number | null;
		bio?: string | null;
		visibility?: PersonaVisibility | null;
	} {
		return {
			id: this.id.toString(),
			name: this.name,
			avatar: this.avatarUrl,
			avatar_color: this.avatarColor,
			banner: this.bannerUrl,
			display_tag_text: this.systemName,
			display_tag_icon: null,
			system_name: this.systemName,
			pronouns: this.pronouns,
			color: this.color,
			bio: this.bio,
			visibility: this.visibility,
		};
	}

	toRow(): PersonaRow {
		return {
			user_id: this.userId,
			persona_id: this.id,
			name: this.name,
			avatar_url: this.avatarUrl,
			banner_url: this.bannerUrl,
			system_name: this.systemName,
			pronouns: this.pronouns,
			color: this.color,
			avatar_color: this.avatarColor,
			bio: this.bio,
			auto_tag_disabled: this.autoTagDisabled,
			persona_tags: JSON.stringify(this.personaTags),
			use_count: this.useCount,
			last_used_at_ms: this.lastUsedAtMs,
			visibility: this.visibility,
			external_uuid: this.externalUuid,
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			deleted_at: this.deletedAt,
			version: this.version,
		};
	}
}

function parsePersonaTags(raw: string | null | undefined): Array<PersonaTag> {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed;
		return [];
	} catch {
		return [];
	}
}
