// SPDX-License-Identifier: AGPL-3.0-or-later

import {createStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const PersonaTagSchema = z.object({
	prefix: z.string().max(32).optional(),
	suffix: z.string().max(32).optional(),
});
export type PersonaTag = z.infer<typeof PersonaTagSchema>;

export const PersonaSchema = z.object({
	id: z.string().min(1).max(64),
	name: createStringType(1, 100).describe('Persona display name'),
	avatar_url: z.string().max(256).nullish().describe('Avatar asset URL or hash'),
	persona_tags: z.array(PersonaTagSchema).optional(),
	system_name: z.string().max(100).nullish().describe('Optional system name/tag'),
	pronouns: z.string().max(100).nullish().describe('Optional pronouns'),
	color: z.number().int().nullish().describe('Optional color integer'),
	auto_tag_disabled: z.boolean().optional(),
	use_count: z.number().int().optional(),
	last_used_at_ms: z.number().int().optional(),
	bio: z.string().max(4096).nullish().describe('Optional persona bio'),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const MessageSubprofileRequestSchema = z.object({
	id: z.string().min(1).max(64),
	name: createStringType(1, 100).describe('Persona display name'),
	avatar: z.string().max(256).nullish().describe('Avatar asset URL or hash'),
	avatar_color: z.number().int().nullish().describe('Avatar accent color'),
	system_name: z.string().max(100).nullish().describe('System name/tag'),
	pronouns: z.string().max(100).nullish().describe('Pronouns'),
	color: z.number().int().nullish().describe('Custom color integer'),
	bio: z.string().max(4096).nullish().describe('Persona bio'),
});
export type MessageSubprofileRequest = z.infer<typeof MessageSubprofileRequestSchema>;

export const MessageSubprofileResponseSchema = z.object({
	id: z.string().describe('Persona ID'),
	name: z.string().describe('Persona display name'),
	avatar: z.string().nullish().describe('Avatar asset URL or hash'),
	avatar_color: z.number().int().nullish().describe('Avatar accent color'),
	system_name: z.string().nullish().describe('System name/tag'),
	pronouns: z.string().nullish().describe('Pronouns'),
	color: z.number().int().nullish().describe('Custom color integer'),
	bio: z.string().nullish().describe('Persona bio'),
});
export type MessageSubprofileResponse = z.infer<typeof MessageSubprofileResponseSchema>;

export const MessagePersonaRequestSchema = MessageSubprofileRequestSchema;
export type MessagePersonaRequest = MessageSubprofileRequest;

export const MessagePersonaResponseSchema = MessageSubprofileResponseSchema;
export type MessagePersonaResponse = MessageSubprofileResponse;
