// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaVisibility} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {z} from 'zod';

/**
 * Who gets a persona in @mention suggestions and in the `from:` / `mentions:` search suggestions
 * (tyne-chat/tyne#652): everyone, only its owner's account, or nobody. A convenience setting for
 * copies of other people's personas, not a privacy one: visibility keeps deciding the gallery and
 * the profile, the persona still speaks, and a typed mention of it still works.
 */
export const PersonaMentionableBySchema = z.enum(['everyone', 'self', 'nobody']);
export type PersonaMentionableBy = z.infer<typeof PersonaMentionableBySchema>;

/**
 * What a persona's stored setting means. Null, until its owner picks a value, follows visibility as
 * suggestions did before the setting existed: a private persona only for its owner, any other for
 * everyone.
 */
export function effectiveMentionableBy(
	stored: PersonaMentionableBy | null | undefined,
	visibility: PersonaVisibility | null | undefined,
): PersonaMentionableBy {
	if (stored) return stored;
	return visibility === 'private' ? 'self' : 'everyone';
}

/** Whether the persona belongs in the suggestions of `viewer`, given whose it is. */
export function isPersonaSuggested(mentionableBy: PersonaMentionableBy, ownedByViewer: boolean): boolean {
	return mentionableBy === 'everyone' || (ownedByViewer && mentionableBy === 'self');
}
