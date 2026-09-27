// SPDX-License-Identifier: AGPL-3.0-or-later

import {createStringType, SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const PersonaTagSchema = z
	.object({
		prefix: z.string().min(1).max(32).optional(),
		suffix: z.string().min(1).max(32).optional(),
	})
	.refine(
		(data) =>
			(data.prefix !== undefined && data.prefix.length > 0) || (data.suffix !== undefined && data.suffix.length > 0),
		{
			message: 'At least one of prefix or suffix must be provided',
		},
	);
export type PersonaTag = z.infer<typeof PersonaTagSchema>;

export const PersonaVisibilitySchema = z.enum(['unlisted', 'public', 'private']).default('unlisted');
export type PersonaVisibility = z.infer<typeof PersonaVisibilitySchema>;

export const MAX_SIGNATURE_EMOJIS_PER_PERSONA = 20;

export const SignatureEmojiSchema = z.object({
	id: SnowflakeStringType.nullish().describe('Custom emoji ID (null for Unicode)'),
	name: z.string().min(1).max(64).describe('Emoji name or Unicode character'),
	animated: z.boolean().nullish().describe('Whether the emoji is animated'),
});
export type SignatureEmoji = z.infer<typeof SignatureEmojiSchema>;

export const PersonaResponseSchema = z.object({
	id: SnowflakeStringType.describe('The unique Snowflake identifier for this persona'),
	name: z.string().describe('The persona display name'),
	avatar_hash: z.string().nullish().describe('Avatar asset hash'),
	banner_hash: z.string().nullish().describe('Banner asset hash'),
	pronouns: z.string().nullish().describe('Optional pronouns'),
	color: z.number().int().nullish().describe('Optional accent color integer'),
	avatar_color: z.number().int().nullish().describe('Avatar accent color'),
	bio: z.string().nullish().describe('Optional persona bio'),
	auto_tag_disabled: z.boolean().default(false).describe('Whether persona tag matching is disabled'),
	persona_tags: z.array(PersonaTagSchema).default([]).describe('Persona prefix and suffix tags'),
	signature_emojis: z.array(SignatureEmojiSchema).optional().default([]).describe('Signature emojis for this persona'),
	use_count: z.number().int().default(0).describe('Usage counter for frecency ranking'),
	last_used_at_ms: z.string().nullish().describe('Timestamp in ms when the persona was last used'),
	visibility: PersonaVisibilitySchema.describe('Visibility setting: unlisted (default), public, or private'),
	external_uuid: z.string().nullish().describe('External UUID for idempotent PluralKit imports'),
	created_at: z.string().describe('ISO timestamp of persona creation'),
	updated_at: z.string().describe('ISO timestamp of last update'),
	deleted_at: z.string().datetime().nullish().optional().describe('ISO timestamp if the persona has been soft-deleted'),
});
export type PersonaResponse = z.infer<typeof PersonaResponseSchema>;

export const PersonaListResponseSchema = z.array(PersonaResponseSchema);
export type PersonaListResponse = z.infer<typeof PersonaListResponseSchema>;

export const PublicPersonaResponseSchema = z.object({
	id: SnowflakeStringType.describe('The unique Snowflake identifier for this persona'),
	name: z.string().describe('The persona display name'),
	avatar_hash: z.string().nullish().describe('Avatar asset hash'),
	banner_hash: z.string().nullish().describe('Banner asset hash'),
	pronouns: z.string().nullish().describe('Optional pronouns'),
	color: z.number().int().nullish().describe('Optional accent color integer'),
	avatar_color: z.number().int().nullish().describe('Avatar accent color'),
	bio: z.string().nullish().describe('Optional persona bio'),
	visibility: PersonaVisibilitySchema.describe('Visibility setting'),
});
export type PublicPersonaResponse = z.infer<typeof PublicPersonaResponseSchema>;

export const PublicPersonaListResponseSchema = z.array(PublicPersonaResponseSchema);
export type PublicPersonaListResponse = z.infer<typeof PublicPersonaListResponseSchema>;

export const PersonaCreateRequestSchema = z.object({
	name: createStringType(1, 100).describe('Persona display name'),
	avatar_hash: z.string().max(64).nullish().optional().describe('Avatar asset hash'),
	banner_hash: z.string().max(64).nullish().optional().describe('Banner asset hash'),
	pronouns: z.string().max(100).nullish().optional().describe('Optional pronouns'),
	color: z.number().int().nullish().optional().describe('Optional color integer'),
	avatar_color: z.number().int().nullish().optional().describe('Optional avatar accent color'),
	bio: z.string().max(4096).nullish().optional().describe('Optional persona bio'),
	auto_tag_disabled: z.boolean().optional().describe('Whether auto-tagging is disabled'),
	persona_tags: z.array(PersonaTagSchema).max(5).optional().describe('Persona prefix/suffix tags'),
	signature_emojis: z
		.array(SignatureEmojiSchema)
		.max(MAX_SIGNATURE_EMOJIS_PER_PERSONA)
		.optional()
		.describe('Signature emojis for this persona'),
	visibility: PersonaVisibilitySchema.optional().describe('Visibility: unlisted (default), public, or private'),
	external_uuid: z.string().max(64).nullish().optional().describe('Optional external UUID (e.g. PluralKit)'),
});
export type PersonaCreateRequest = z.infer<typeof PersonaCreateRequestSchema>;

export const PersonaUpdateRequestSchema = z.object({
	name: createStringType(1, 100).optional().describe('Persona display name'),
	avatar_hash: z.string().max(64).nullish().optional().describe('Avatar asset hash'),
	banner_hash: z.string().max(64).nullish().optional().describe('Banner asset hash'),
	pronouns: z.string().max(100).nullish().optional().describe('Optional pronouns'),
	color: z.number().int().nullish().optional().describe('Optional color integer'),
	avatar_color: z.number().int().nullish().optional().describe('Optional avatar accent color'),
	bio: z.string().max(4096).nullish().optional().describe('Optional persona bio'),
	auto_tag_disabled: z.boolean().optional().describe('Whether auto-tagging is disabled'),
	persona_tags: z.array(PersonaTagSchema).max(5).optional().describe('Persona prefix/suffix tags'),
	signature_emojis: z
		.array(SignatureEmojiSchema)
		.max(MAX_SIGNATURE_EMOJIS_PER_PERSONA)
		.optional()
		.describe('Signature emojis for this persona'),
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

export const ActivePersonaModeSchema = z.enum(['manual', 'last']);
export type ActivePersonaMode = z.infer<typeof ActivePersonaModeSchema>;

export const PersonaSettingsResponseSchema = z.object({
	user_id: SnowflakeStringType.describe('User Snowflake ID'),
	active_persona_mode: ActivePersonaModeSchema.default('manual'),
	active_persona_id: SnowflakeStringType.nullish(),
	is_latched: z.boolean().default(false),
	display_tag_text: z.string().max(100).nullish(),
	display_tag_icon: z.string().max(256).nullish(),
	updated_at: z.string().optional(),
});
export type PersonaSettingsResponse = z.infer<typeof PersonaSettingsResponseSchema>;

export const PersonaSettingsUpdateRequestSchema = z.object({
	active_persona_mode: ActivePersonaModeSchema.optional(),
	active_persona_id: SnowflakeStringType.nullish().optional(),
	is_latched: z.boolean().optional(),
	display_tag_text: z.string().max(100).nullish().optional(),
	display_tag_icon: z.string().max(256).nullish().optional(),
});
export type PersonaSettingsUpdateRequest = z.infer<typeof PersonaSettingsUpdateRequestSchema>;

export const ChannelPersonaMentionItemSchema = z.object({
	id: SnowflakeStringType.describe('The unique Snowflake identifier for this persona'),
	name: z.string().describe('The persona display name'),
	avatar_hash: z.string().nullish().describe('Avatar asset hash'),
	banner_hash: z.string().nullish().describe('Banner asset hash'),
	display_tag_text: z.string().nullish().describe('Optional display tag text'),
	display_tag_icon: z.string().nullish().describe('Optional display tag icon'),
	pronouns: z.string().nullish().describe('Optional pronouns'),
	color: z.number().int().nullish().describe('Optional accent color integer'),
	bio: z.string().nullish().describe('Optional persona bio'),
	visibility: PersonaVisibilitySchema.describe('Visibility setting'),
	use_count: z.number().int().optional().default(0).describe('Usage counter for frecency ranking'),
	last_used_at_ms: z.string().nullish().describe('Timestamp in ms when the persona was last used'),
	owner_user_id: SnowflakeStringType.describe('User ID of the persona owner'),
	owner_username: z.string().describe('Username of the persona owner'),
	owner_discriminator: z.string().nullish().describe('Discriminator of the persona owner'),
	owner_global_name: z.string().nullish().describe('Global display name of the persona owner'),
	owner_nickname: z.string().nullish().describe('Guild nickname if applicable'),
});
export type ChannelPersonaMentionItem = z.infer<typeof ChannelPersonaMentionItemSchema>;

export const ChannelPersonaMentionsResponseSchema = z.array(ChannelPersonaMentionItemSchema);
export type ChannelPersonaMentionsResponse = z.infer<typeof ChannelPersonaMentionsResponseSchema>;

export const ChannelPersonaMentionsQuerySchema = z.object({
	q: z.string().max(100).optional().default(''),
	limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});
export type ChannelPersonaMentionsQuery = z.infer<typeof ChannelPersonaMentionsQuerySchema>;
