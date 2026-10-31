// SPDX-License-Identifier: AGPL-3.0-or-later

import {normalizeSubprofile, PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {MatchResult} from '@fluxer/schema/src/domains/persona/PersonaMatcher';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

export interface OutgoingPersona {
	content: string;
	subprofile: MessageSubprofileResponse | undefined;
}

/**
 * Works out which persona a message is sent as and takes the persona tag out of its text.
 *
 * This is the send itself as far as the persona store is concerned: it records the persona's use,
 * follows "last used" mode and applies a backslash escape. Call it once per message, after every
 * check that can still refuse the send.
 */
export function resolveOutgoingPersona(
	channelId: string | null,
	content: string,
	hasAttachments: boolean,
	options?: {allowEmptyContent?: boolean},
): OutgoingPersona {
	const match = PersonaStore.matchOutgoingMessage(channelId, content, hasAttachments, options);
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

/**
 * What a forward and its comment go out as. They are one thing said by one speaker, so a tag in the
 * comment decides for both. Without one they use the persona selected where the forward started,
 * which is the one on screen, and then the destination's, so that the account does not turn up in a
 * channel where a persona was chosen. Call it once per destination.
 */
export function resolveForwardPersona(sourceChannelId: string, channelId: string, comment: string): OutgoingPersona {
	const selectionChannelId = PersonaStore.latchedPersonaFor(sourceChannelId) ? sourceChannelId : channelId;
	return resolveOutgoingPersona(selectionChannelId, comment, false, {allowEmptyContent: true});
}

/**
 * What a sticker, GIF or meme goes out as. The draft decides: a tag names the persona and a backslash
 * sends it as the account (tyne-chat/tyne#54). Only a draft that says neither leaves it to the
 * message's own text. Call it once per message.
 */
export function resolveExpressionPersona(
	channelId: string | null,
	draft: string,
	content: string,
	hasAttachments?: boolean,
): MatchResult['persona'] | null {
	const options = {allowEmptyContent: true};
	const draftMatch = draft ? PersonaStore.matchOutgoingMessage(channelId, draft, hasAttachments, options) : null;
	if (draftMatch?.matched && draftMatch.persona) return draftMatch.persona;
	if (draftMatch?.wasEscaped) return null;
	const contentMatch = PersonaStore.matchOutgoingMessage(channelId, content, hasAttachments, options);
	return contentMatch.matched && contentMatch.persona ? contentMatch.persona : null;
}

/** See `PersonaStore.startChannelAs`. For the composers that create a thread or a forum post. */
export function startChannelAsPersona(channelId: string, personaId: string | null | undefined): void {
	PersonaStore.startChannelAs(channelId, personaId);
}

/** A lone `\\` clears the active persona and is not a message. Returns true when it was consumed. */
export function consumePersonaCommand(channelId: string | null, content: string): boolean {
	return PersonaStore.handleInChatCommand(channelId, content).handled;
}
