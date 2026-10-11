// SPDX-License-Identifier: AGPL-3.0-or-later

import {z} from 'zod';
import {PersonaVisibilitySchema} from './PersonaApiSchemas';

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

export * from './PersonaApiSchemas';
