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
 * Who a forward goes out as when the Forward dialog's "Forward as" was used: a persona, or `null` for
 * the account (tyne-chat/tyne#817).
 */
export type ForwardAs = MessageSubprofileResponse | null;

/**
 * What a forward and its comment go out as without the Forward dialog's choice (callers other than
 * the dialog): the persona selected where the forward started, which is the one on screen, and then
 * the destination's, so that the account does not turn up in a channel where a persona was chosen. A
 * tag in the comment decides for both, as in the message box. Call it once per destination.
 */
export function resolveForwardPersona(sourceChannelId: string, channelId: string, comment: string): OutgoingPersona {
	const selectionChannelId = PersonaStore.latchedPersonaFor(sourceChannelId) ? sourceChannelId : channelId;
	return resolveOutgoingPersona(selectionChannelId, comment, false, {allowEmptyContent: true});
}

/**
 * What a forward and its comment go out as with the Forward dialog's choice, `forwardAs`, which is
 * what the dialog showed. They are one thing said by one speaker, so a tag in the comment decides for
 * both, and a backslash sends them as the account. Either way this is a choice made in the dialog,
 * like a pick: it changes no channel's selection, even in "last used" mode, and records one use for
 * the whole forward. Call it once per forward, not per destination (tyne-chat/tyne#817).
 */
export function resolveDialogForwardPersona(comment: string, forwardAs: ForwardAs): OutgoingPersona {
	const said = PersonaStore.matchTagOnly(comment, forwardAs?.id ?? null);
	if (said.isFromTag && said.persona) {
		void PersonaStore.recordPersonaUse(said.persona.id);
		return {
			content: said.strippedContent,
			subprofile: normalizeSubprofile(said.persona, {
				display_tag_text: PersonaStore.displayTagText || null,
				display_tag_icon: PersonaStore.displayTagIcon || null,
			}),
		};
	}
	if (said.wasEscaped) {
		return {content: said.strippedContent, subprofile: undefined};
	}
	if (forwardAs != null) {
		void PersonaStore.recordPersonaUse(forwardAs.id);
	}
	return {content: comment, subprofile: forwardAs ?? undefined};
}

/**
 * Who the Forward dialog shows the forward going out as before anyone picks: the persona active in
 * the channel it is forwarded from (the one on screen), else the account (tyne-chat/tyne#817).
 */
export function defaultForwardAs(sourceChannelId: string): ForwardAs {
	return PersonaStore.getActiveSubprofile(sourceChannelId);
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

/**
 * A lone `\\` clears the active persona, and a persona's tag with nothing in it selects that persona;
 * neither is a message. `hasMedia`: the message has an attachment, sticker or meme, which a tag names
 * the sender of instead. Returns true when it was consumed.
 */
export function consumePersonaCommand(channelId: string | null, content: string, hasMedia: boolean): boolean {
	return PersonaStore.handleInChatCommand(channelId, content, hasMedia).handled;
}
