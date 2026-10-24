// SPDX-License-Identifier: AGPL-3.0-or-later

import {SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';
import {PersonaAssetHashType, PersonaVisibilitySchema} from './PersonaApiSchemas';

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
	avatar: PersonaAssetHashType.nullish().describe('Avatar asset hash'),
	avatar_color: z.number().int().nullish().describe('Avatar accent color'),
	display_tag_text: z.string().nullish().optional().describe('Display tag text'),
	display_tag_icon: PersonaAssetHashType.nullish()
		.optional()
		.describe('Hash of the display tag icon, an image stored under the account'),
	color: z.number().int().nullish().describe('Custom color integer'),
	visibility: PersonaVisibilitySchema.nullish().optional().describe('Persona visibility setting'),
});
export type MessageSubprofileResponse = z.infer<typeof MessageSubprofileResponseSchema>;

/** The most personas one lookup takes. */
export const MAX_PERSONA_LOOKUP_IDS = 100;

/**
 * Personas to look up, each named by its owner and its ID. Knowing a persona's ID entitles anyone signed
 * in to what a message from it shows, whatever its visibility: an ID is only learned from something
 * already seen.
 */
export const PersonaLookupRequestSchema = z.object({
	personas: z
		.array(
			z.object({
				user_id: SnowflakeStringType.describe('The persona owner’s user ID'),
				persona_id: SnowflakeStringType.describe('The persona’s ID'),
			}),
		)
		.min(1)
		.max(MAX_PERSONA_LOOKUP_IDS)
		.describe('Personas to look up'),
});

/** A persona found, as a message shows it, with its owner. */
export const PersonaLookupItemSchema = MessageSubprofileResponseSchema.extend({
	user_id: z.string().describe('The persona owner’s user ID'),
});
export type PersonaLookupItem = z.infer<typeof PersonaLookupItemSchema>;

/** The personas found; pairs that name no persona of that user are left out. */
export const PersonaLookupResponseSchema = z.array(PersonaLookupItemSchema);
export type PersonaLookupResponse = z.infer<typeof PersonaLookupResponseSchema>;

export * from './PersonaApiSchemas';
