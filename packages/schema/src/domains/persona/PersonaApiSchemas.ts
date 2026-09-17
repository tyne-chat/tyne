// SPDX-License-Identifier: AGPL-3.0-or-later

import {createStringType, SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const PersonaTagSchema = z.object({
	prefix: z.string().max(32).optional(),
	suffix: z.string().max(32).optional(),
});
export type PersonaTag = z.infer<typeof PersonaTagSchema>;

export const PersonaVisibilitySchema = z.enum(['unlisted', 'public', 'private']).default('unlisted');
export type PersonaVisibility = z.infer<typeof PersonaVisibilitySchema>;

export const PersonaResponseSchema = z.object({
	id: SnowflakeStringType.describe('The unique Snowflake identifier for this persona'),
	name: z.string().describe('The persona display name'),
	avatar_url: z.string().nullish().describe('Avatar asset URL or hash'),
	system_name: z.string().nullish().describe('Optional system name or tag'),
	pronouns: z.string().nullish().describe('Optional pronouns'),
	color: z.number().int().nullish().describe('Optional accent color integer'),
	bio: z.string().nullish().describe('Optional persona bio'),
	auto_tag_disabled: z.boolean().default(false).describe('Whether persona tag matching is disabled'),
	persona_tags: z.array(PersonaTagSchema).default([]).describe('Persona prefix and suffix tags'),
	use_count: z.number().int().default(0).describe('Usage counter for frecency ranking'),
	last_used_at_ms: z.string().nullish().describe('Timestamp in ms when the persona was last used'),
	visibility: PersonaVisibilitySchema.describe('Visibility setting: unlisted (default), public, or private'),
	external_uuid: z.string().nullish().describe('External UUID for idempotent PluralKit imports'),
	created_at: z.string().describe('ISO timestamp of persona creation'),
	updated_at: z.string().describe('ISO timestamp of last update'),
});
export type PersonaResponse = z.infer<typeof PersonaResponseSchema>;

export const PublicPersonaResponseSchema = z.object({
	id: SnowflakeStringType.describe('The unique Snowflake identifier for this persona'),
	name: z.string().describe('The persona display name'),
	avatar_url: z.string().nullish().describe('Avatar asset URL or hash'),
	system_name: z.string().nullish().describe('Optional system name or tag'),
	pronouns: z.string().nullish().describe('Optional pronouns'),
	color: z.number().int().nullish().describe('Optional accent color integer'),
	bio: z.string().nullish().describe('Optional persona bio'),
	visibility: PersonaVisibilitySchema.describe('Visibility setting'),
});
export type PublicPersonaResponse = z.infer<typeof PublicPersonaResponseSchema>;

export const PersonaCreateRequestSchema = z.object({
	name: createStringType(1, 100).describe('Persona display name'),
	avatar_url: z.string().max(256).nullish().optional().describe('Avatar asset URL or hash'),
	system_name: z.string().max(100).nullish().optional().describe('Optional system name/tag'),
	pronouns: z.string().max(100).nullish().optional().describe('Optional pronouns'),
	color: z.number().int().nullish().optional().describe('Optional color integer'),
	bio: z.string().max(4096).nullish().optional().describe('Optional persona bio'),
	auto_tag_disabled: z.boolean().optional().describe('Whether auto-tagging is disabled'),
	persona_tags: z.array(PersonaTagSchema).max(5).optional().describe('Persona prefix/suffix tags'),
	visibility: PersonaVisibilitySchema.optional().describe('Visibility: unlisted (default), public, or private'),
	external_uuid: z.string().max(64).nullish().optional().describe('Optional external UUID (e.g. PluralKit)'),
});
export type PersonaCreateRequest = z.infer<typeof PersonaCreateRequestSchema>;

export const PersonaUpdateRequestSchema = z.object({
	name: createStringType(1, 100).optional().describe('Persona display name'),
	avatar_url: z.string().max(256).nullish().optional().describe('Avatar asset URL or hash'),
	system_name: z.string().max(100).nullish().optional().describe('Optional system name/tag'),
	pronouns: z.string().max(100).nullish().optional().describe('Optional pronouns'),
	color: z.number().int().nullish().optional().describe('Optional color integer'),
	bio: z.string().max(4096).nullish().optional().describe('Optional persona bio'),
	auto_tag_disabled: z.boolean().optional().describe('Whether auto-tagging is disabled'),
	persona_tags: z.array(PersonaTagSchema).max(5).optional().describe('Persona prefix/suffix tags'),
	visibility: z.enum(['unlisted', 'public', 'private']).optional().describe('Visibility setting'),
	external_uuid: z.string().max(64).nullish().optional().describe('Optional external UUID'),
});
export type PersonaUpdateRequest = z.infer<typeof PersonaUpdateRequestSchema>;

export const PersonaBulkImportRequestSchema = z.preprocess(
	(val) =>
		val && typeof val === 'object' && !Array.isArray(val) && Array.isArray((val as any).personas)
			? (val as any).personas
			: val,
	z.array(PersonaCreateRequestSchema).max(250),
);
export type PersonaBulkImportRequest = z.infer<typeof PersonaBulkImportRequestSchema>;

export const PersonaIdParam = z.object({
	persona_id: SnowflakeStringType.describe('Persona Snowflake ID'),
});

export const UserIdPersonaIdParam = z.object({
	user_id: SnowflakeStringType.describe('User Snowflake ID'),
	persona_id: SnowflakeStringType.describe('Persona Snowflake ID'),
});

export const PersonaSettingsResponseSchema = z.object({
	user_id: SnowflakeStringType.describe('User Snowflake ID'),
	active_persona_mode: z.enum(['off', 'manual', 'last']).default('off'),
	active_persona_id: SnowflakeStringType.nullish(),
	is_latched: z.boolean().default(false),
	display_tag_text: z.string().max(100).nullish(),
	display_tag_icon: z.string().max(256).nullish(),
	updated_at: z.string().optional(),
});
export type PersonaSettingsResponse = z.infer<typeof PersonaSettingsResponseSchema>;

export const PersonaSettingsUpdateRequestSchema = z.object({
	active_persona_mode: z.enum(['off', 'manual', 'last']).optional(),
	active_persona_id: SnowflakeStringType.nullish().optional(),
	is_latched: z.boolean().optional(),
	display_tag_text: z.string().max(100).nullish().optional(),
	display_tag_icon: z.string().max(256).nullish().optional(),
});
export type PersonaSettingsUpdateRequest = z.infer<typeof PersonaSettingsUpdateRequestSchema>;
