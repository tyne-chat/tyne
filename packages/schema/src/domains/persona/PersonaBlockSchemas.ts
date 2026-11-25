// SPDX-License-Identifier: AGPL-3.0-or-later

import {SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

/**
 * Fork: personas one has blocked (tyne-chat/tyne#921). Clients treat a blocked persona's messages as
 * they treat a blocked account's: collapsed, or hidden with the setting that hides blocked messages.
 * Nothing else about the persona changes, and its account's other personas are not affected. The
 * list is private: only the sessions of the account that blocked see it.
 */

/** How many personas an account can block. */
export const PERSONA_BLOCKS_MAX = 1000;

export const PersonaBlockResponseSchema = z.object({
	user_id: SnowflakeStringType.describe('The ID of the account the blocked persona belongs to'),
	persona_id: SnowflakeStringType.describe('The ID of the blocked persona'),
});
export type PersonaBlockResponse = z.infer<typeof PersonaBlockResponseSchema>;

export const PersonaBlockListResponseSchema = z
	.array(PersonaBlockResponseSchema)
	.describe('The blocked personas, the oldest block first');
export type PersonaBlockListResponse = z.infer<typeof PersonaBlockListResponseSchema>;

export const PersonaBlockParam = z.object({
	user_id: SnowflakeStringType.describe('The ID of the account the persona belongs to'),
	persona_id: SnowflakeStringType.describe('The ID of the persona'),
});

/** `USER_PERSONA_BLOCKS_UPDATE`, to the account's own sessions after every block and unblock: the whole list. */
export const PersonaBlocksUpdateEventSchema = z.object({
	blocks: PersonaBlockListResponseSchema,
});
export type PersonaBlocksUpdateEvent = z.infer<typeof PersonaBlocksUpdateEventSchema>;
