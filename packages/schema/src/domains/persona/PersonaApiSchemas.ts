// SPDX-License-Identifier: AGPL-3.0-or-later

import {createStringType, SnowflakeStringType, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
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

export const MAX_SIGNATURE_EMOJIS_PER_PERSONA = 10000;

export const SignatureEmojiSchema = z.object({
	id: SnowflakeStringType.nullish().describe('Custom emoji ID (null for Unicode)'),
	name: z.string().min(1).max(64).describe('Emoji name or Unicode character'),
	animated: z.boolean().nullish().describe('Whether the emoji is animated'),
});
export type SignatureEmoji = z.infer<typeof SignatureEmojiSchema>;

// Persona image hashes are issued by the upload and import routes: the first 8 hex characters of the image's MD5,
// prefixed with "a_" when animated. They are interpolated into media URLs and storage keys, so nothing else is accepted.
const PERSONA_ASSET_HASH_PATTERN = /^(a_)?[0-9a-f]{8}$/;
const PersonaAssetHashType = z
	.string()
	.regex(PERSONA_ASSET_HASH_PATTERN, 'Must be a hash returned by the persona avatar or banner upload routes');

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
	avatar_hash: PersonaAssetHashType.nullish().optional().describe('Avatar asset hash'),
	banner_hash: PersonaAssetHashType.nullish().optional().describe('Banner asset hash'),
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
	avatar_hash: PersonaAssetHashType.nullish().optional().describe('Avatar asset hash'),
	banner_hash: PersonaAssetHashType.nullish().optional().describe('Banner asset hash'),
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

/**
 * Where an imported persona's images came from, so that an export can link to them there again for
 * as long as the image is unchanged. The avatar's field is kept even without a link: PluralKit
 * shows `webhook_avatar_url` on messages and `avatar_url` on the member card, and the export
 * writes the avatar back to the field it came from.
 */
export const PersonaImportImageSourcesSchema = z.object({
	avatar: z
		.object({
			url: z.string().max(2048).nullish().describe('The link the avatar was imported from'),
			field: z.enum(['avatar_url', 'webhook_avatar_url']).describe('The PluralKit field it came from'),
			main_avatar_empty: z
				.boolean()
				.optional()
				.describe("Whether the member's avatar_url was empty, when the avatar came from webhook_avatar_url"),
		})
		.nullish(),
	banner: z
		.object({
			url: z.string().max(2048).nullish().describe('The link the banner was imported from'),
		})
		.nullish(),
});
export type PersonaImportImageSources = z.infer<typeof PersonaImportImageSourcesSchema>;

export const PersonaImportItemSchema = PersonaCreateRequestSchema.extend({
	image_sources: PersonaImportImageSourcesSchema.nullish().describe(
		"Where the persona's images were imported from; null when the file gave it none",
	),
});
export type PersonaImportItem = z.infer<typeof PersonaImportItemSchema>;

export const PersonaBulkImportRequestSchema = z.preprocess(
	(val) =>
		val && typeof val === 'object' && !Array.isArray(val) && Array.isArray((val as any).personas)
			? (val as any).personas
			: val,
	z.array(PersonaImportItemSchema).max(250),
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

/**
 * Where the persona someone has selected applies. `global`: one selection for every channel, kept
 * in `active_persona_id`. `channel`: each channel remembers its own, kept as channel states; a
 * channel without one is used as the account itself.
 */
export const ActivePersonaScopeSchema = z.enum(['global', 'channel']);
export type ActivePersonaScope = z.infer<typeof ActivePersonaScopeSchema>;

export const PersonaSettingsResponseSchema = z.object({
	user_id: SnowflakeStringType.describe('User Snowflake ID'),
	active_persona_mode: ActivePersonaModeSchema.default('manual'),
	active_persona_scope: ActivePersonaScopeSchema.default('global').describe(
		'Whether the selected persona is one for every channel or remembered per channel',
	),
	active_persona_id: SnowflakeStringType.nullish(),
	is_latched: z.boolean().default(false),
	display_tag_text: z.string().max(100).nullish(),
	display_tag_icon: z.string().max(256).nullish(),
	updated_at: z.string().optional(),
});
export type PersonaSettingsResponse = z.infer<typeof PersonaSettingsResponseSchema>;

export const PersonaSettingsUpdateRequestSchema = z.object({
	active_persona_mode: ActivePersonaModeSchema.optional(),
	active_persona_scope: ActivePersonaScopeSchema.optional(),
	active_persona_id: SnowflakeStringType.nullish().optional(),
	is_latched: z.boolean().optional(),
	display_tag_text: z.string().max(100).nullish().optional(),
	display_tag_icon: z.string().max(256).nullish().optional(),
});
export type PersonaSettingsUpdateRequest = z.infer<typeof PersonaSettingsUpdateRequestSchema>;

export const PersonaChannelStateSchema = z.object({
	channel_id: SnowflakeStringType.describe('The channel this selection belongs to'),
	persona_id: SnowflakeStringType.nullable().describe(
		'The persona selected in the channel, or null when the channel is used as the account itself',
	),
});
export type PersonaChannelState = z.infer<typeof PersonaChannelStateSchema>;

export const PersonaChannelStatesResponseSchema = z.object({
	states: z.array(PersonaChannelStateSchema).describe('Every channel that has a persona selected'),
});
export type PersonaChannelStatesResponse = z.infer<typeof PersonaChannelStatesResponseSchema>;

export const PersonaChannelStateUpdateRequestSchema = z.object({
	persona_id: SnowflakeStringType.nullable().describe('The persona to select in the channel, or null for the account'),
});
export type PersonaChannelStateUpdateRequest = z.infer<typeof PersonaChannelStateUpdateRequestSchema>;

export const PersonaChannelStateParam = z.object({
	channel_id: SnowflakeType.describe('The ID of the channel'),
});

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

export const PersonaAvatarUploadRequest = z.object({
	avatar: z.string().describe('Base64 data URI of the avatar image'),
});
export const PersonaAvatarUploadResponse = z.object({
	avatar_hash: z.string().describe('Hash of the uploaded avatar'),
	avatar_color: z.number().int().nullish().optional().describe('Dominant avatar color'),
});

export const PersonaBannerUploadRequest = z.object({
	banner: z.string().describe('Base64 data URI of the banner image'),
});
export const PersonaBannerUploadResponse = z.object({
	banner_hash: z.string().describe('Hash of the uploaded banner'),
});

export const PersonaAvatarImportRequest = z.object({
	url: z.string().url().max(2048).describe('Remote URL of the avatar image to import'),
});
export const PersonaAvatarImportResponse = z.object({
	avatar_hash: z.string().describe('Hash of the imported avatar'),
	avatar_color: z.number().int().nullish().optional().describe('Dominant avatar color'),
});

export const PersonaImportImageKindSchema = z.enum(['avatar', 'banner']);

export const PersonaBatchAvatarImportRequest = z.object({
	urls: z.array(z.string().url().max(2048)).min(1).max(500).describe('List of remote avatar URLs to import'),
	kind: PersonaImportImageKindSchema.optional().describe(
		'Whether the links are avatars or banners; avatars when absent',
	),
});

export const PersonaImportImageRequest = z.object({
	kind: PersonaImportImageKindSchema.describe('Whether the image is an avatar or a banner'),
	image: z.string().describe('Base64 data URI of the image'),
});
export const PersonaImportImageResponse = z.object({
	hash: z.string().describe('Hash of the stored image'),
	avatar_color: z.number().int().nullish().describe('Dominant colour, for an avatar'),
});

export const PersonaExportResponse = z
	.file()
	.describe(
		'A ZIP file with the personas as a PluralKit export (pluralkit.json), their images, tyne.json and a README',
	);
