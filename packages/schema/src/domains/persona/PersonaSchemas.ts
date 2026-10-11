// SPDX-License-Identifier: AGPL-3.0-or-later

import {createStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';
import {PersonaTagSchema, PersonaVisibilitySchema, SignatureEmojiSchema} from './PersonaApiSchemas';

export const PersonaSchema = z.object({
	id: z.string().min(1).max(64),
	name: createStringType(1, 100).describe('Persona display name'),
	avatar_hash: z.string().max(64).nullish().describe('Avatar asset hash'),
	banner_hash: z.string().max(64).nullish().describe('Banner asset hash'),
	persona_tags: z.array(PersonaTagSchema).optional(),
	signature_emojis: z.array(SignatureEmojiSchema).optional(),
	pronouns: z.string().max(100).nullish().describe('Optional pronouns'),
	color: z.number().int().nullish().describe('Optional color integer'),
	avatar_color: z.number().int().nullish().describe('Avatar accent color'),
	auto_tag_disabled: z.boolean().optional(),
	use_count: z.number().int().optional(),
	last_used_at_ms: z.number().int().optional(),
	bio: z.string().max(4096).nullish().describe('Optional persona bio'),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const MessageSubprofileRequestSchema = z.object({
	id: z.string().min(1).max(64),
	name: createStringType(1, 100).describe('Persona display name'),
	avatar: z.string().max(256).nullish().optional().describe('Avatar asset URL or hash'),
	avatar_color: z.number().int().nullish().optional().describe('Avatar accent color'),
	banner: z.string().max(256).nullish().optional().describe('Banner asset URL or hash'),
	display_tag_text: z.string().max(100).nullish().optional().describe('Display tag text'),
	display_tag_icon: z.string().max(256).nullish().optional().describe('Display tag icon URL or hash'),
	pronouns: z.string().max(100).nullish().optional().describe('Pronouns'),
	color: z.number().int().nullish().optional().describe('Custom color integer'),
	bio: z.string().max(4096).nullish().optional().describe('Persona bio (deprecated on message)'),
	visibility: PersonaVisibilitySchema.nullish().optional().describe('Persona visibility setting'),
});
export type MessageSubprofileRequest = z.infer<typeof MessageSubprofileRequestSchema>;

/**
 * What clients released before `persona_id` send to name the persona of a message or of typing:
 * a copy of the whole persona. Only its id was ever used, and only its id is read; whatever else
 * it carries is dropped.
 */
export const LegacyMessageSubprofileRequestSchema = z.object({
	id: z.string().min(1).max(64),
});
export type LegacyMessageSubprofileRequest = z.infer<typeof LegacyMessageSubprofileRequestSchema>;

/**
 * Who a message, reaction, typing indicator or signal is from: what is drawn beside it, and the
 * persona's visibility, which clients use to keep other people's private personas out of mention
 * suggestions. The profile itself (bio, banner) is fetched when someone opens it, where that
 * visibility decides who gets it.
 */
export const MessageSubprofileResponseSchema = z.object({
	id: z.string().describe('Persona ID'),
	name: z.string().describe('Persona display name'),
	avatar: z.string().nullish().describe('Avatar asset URL or hash'),
	avatar_color: z.number().int().nullish().describe('Avatar accent color'),
	display_tag_text: z.string().nullish().optional().describe('Display tag text'),
	display_tag_icon: z.string().nullish().optional().describe('Display tag icon URL or hash'),
	pronouns: z.string().nullish().describe('Pronouns'),
	color: z.number().int().nullish().describe('Custom color integer'),
	visibility: PersonaVisibilitySchema.nullish().optional().describe('Persona visibility setting'),
});
export type MessageSubprofileResponse = z.infer<typeof MessageSubprofileResponseSchema>;

export const MessagePersonaRequestSchema = MessageSubprofileRequestSchema;
export type MessagePersonaRequest = MessageSubprofileRequest;

export const MessagePersonaResponseSchema = MessageSubprofileResponseSchema;
export type MessagePersonaResponse = MessageSubprofileResponse;

export * from './PersonaApiSchemas';
