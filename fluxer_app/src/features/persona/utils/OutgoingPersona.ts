// SPDX-License-Identifier: AGPL-3.0-or-later

import {normalizeSubprofile, PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {MessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

export interface OutgoingPersona {
	content: string;
	subprofile: MessageSubprofileRequest | undefined;
}

/**
 * Works out which persona a message is sent as and takes the persona tag out of its text.
 *
 * This is the send itself as far as the persona store is concerned: it records the persona's use,
 * follows "last used" mode and applies a backslash escape. Call it once per message, after every
 * check that can still refuse the send.
 */
export function resolveOutgoingPersona(
	content: string,
	hasAttachments: boolean,
	options?: {allowEmptyContent?: boolean},
): OutgoingPersona {
	const match = PersonaStore.matchOutgoingMessage(content, hasAttachments, options);
	return {
		content: match.matched || match.wasEscaped ? match.strippedContent : content,
		subprofile:
			match.matched && match.persona
				? normalizeSubprofile(match.persona, {
						display_tag_text: PersonaStore.displayTagText || null,
						display_tag_icon: PersonaStore.displayTagIcon || null,
					})
				: undefined,
	};
}

/** A lone `\\` clears the active persona and is not a message. Returns true when it was consumed. */
export function consumePersonaCommand(content: string): boolean {
	return PersonaStore.handleInChatCommand(content).handled;
}
