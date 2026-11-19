// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import {
	effectiveMentionableBy,
	isPersonaSuggested,
	type PersonaMentionableBy,
} from '@fluxer/schema/src/domains/persona/PersonaMentionableBy';

// Who gets a persona in mention and search suggestions (tyne-chat/tyne#652). Other accounts'
// personas come only from the server's mention route, which applies the setting; these decide for
// the account's own personas, which the client takes from its own store.

/** The persona's setting as it applies now: the stored one, or what its visibility implies. */
export function personaMentionableBy(
	persona: Pick<ClientPersona, 'mentionable_by' | 'visibility'>,
): PersonaMentionableBy {
	return effectiveMentionableBy(persona.mentionable_by, persona.visibility);
}

/** Whether one of the account's own personas belongs in its own suggestions: unless it is for nobody. */
export function isOwnPersonaSuggested(persona: Pick<ClientPersona, 'mentionable_by' | 'visibility'>): boolean {
	return isPersonaSuggested(personaMentionableBy(persona), true);
}
