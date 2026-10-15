// SPDX-License-Identifier: AGPL-3.0-or-later

import {SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

/**
 * Message search fields that name personas, spread into upstream's `MessageSearchRequest`.
 *
 * `author_id` keeps matching every message an account sent, as any of its personas. `persona_id`
 * narrows to one persona; when both are given, a message matches if it is from any of the accounts
 * or any of the personas, the same way several `author_id`s combine. Mention filters combine like
 * upstream's `mentions`: every persona listed must be mentioned.
 */
export const PersonaMessageSearchRequestFields = {
	persona_id: z
		.array(SnowflakeType)
		.max(100)
		.optional()
		.describe('Persona IDs to filter by; a message matches if it is from any author_id or any persona_id given'),
	exclude_persona_id: z.array(SnowflakeType).max(100).optional().describe('Persona IDs whose messages to exclude'),
	persona_mentions: z.array(SnowflakeType).max(100).optional().describe('Persona IDs that must be mentioned'),
	exclude_persona_mentions: z
		.array(SnowflakeType)
		.max(100)
		.optional()
		.describe('Persona IDs that must not be mentioned'),
};
