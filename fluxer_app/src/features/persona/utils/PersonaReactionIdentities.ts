// SPDX-License-Identifier: AGPL-3.0-or-later

import {hasPersonaReacted} from '@app/features/messaging/utils/ReactionUtils';
import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

/** One of the identities that can react: a persona's id, or `null` for the account itself. */
export type ReactionIdentityId = string | null;

/** Which of the account's identities reacted with this emoji: the account first (`null`), then personas. */
export function ownReactedIds(reaction: MessageReaction | undefined | null): Array<ReactionIdentityId> {
	if (!reaction) return [];
	const personas = (reaction.persona_reactions ?? []).filter((entry) => entry.me).map((entry) => entry.persona_id);
	return hasPersonaReacted(reaction, null) ? [null, ...personas] : personas;
}

/** How many of the account's identities (the account and each persona) reacted with this emoji. */
export function countOwnReactions(reaction: MessageReaction | undefined | null): number {
	return ownReactedIds(reaction).length;
}

/**
 * Whether a click on this reaction chip opens "Your reactions" instead of reacting: only for an
 * account with personas that react as several at once (its setting), once one of its identities has
 * reacted.
 */
export function opensOwnReactionsMenu(
	reaction: MessageReaction | undefined | null,
	personas: ReadonlyArray<ClientPersona>,
	multiPersonaReactions = true,
): boolean {
	return multiPersonaReactions && personas.length > 0 && countOwnReactions(reaction) > 0;
}

/**
 * The order the rows keep while the list is open: those who reacted, then everyone else. Within each,
 * the current persona first, then the account, then by name (as `personas` is given). The order is
 * taken once, so a row never moves under the pointer when it is toggled.
 */
export function orderIdentitiesForReaction(
	reaction: MessageReaction | undefined | null,
	currentId: ReactionIdentityId,
	personas: ReadonlyArray<ClientPersona>,
): {reacted: Array<ReactionIdentityId>; rest: Array<ReactionIdentityId>} {
	const ids: Array<ReactionIdentityId> = [null, ...personas.map((p) => p.id)];
	const rank = (id: ReactionIdentityId) => {
		if (id === currentId) return 0;
		return id === null ? 1 : 2;
	};
	const ordered = ids
		.map((id, index) => ({id, index}))
		.sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index)
		.map((entry) => entry.id);
	return {
		reacted: ordered.filter((id) => hasPersonaReacted(reaction, id)),
		rest: ordered.filter((id) => !hasPersonaReacted(reaction, id)),
	};
}

/** The most recently and often used personas (`rankedPersonas` order), leaving out ones never used. */
export function recentPersonaIds(ranked: ReadonlyArray<ClientPersona>, limit: number): Array<string> {
	return ranked
		.filter((p) => (p.use_count ?? 0) > 0 && p.last_used_at_ms != null)
		.slice(0, limit)
		.map((p) => p.id);
}

/** Search over name, pronouns and proxy tags, as the persona pickers do. */
export function personaMatchesQuery(persona: ClientPersona, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	if (persona.name.toLowerCase().includes(q)) return true;
	if (persona.pronouns?.toLowerCase().includes(q)) return true;
	return (persona.persona_tags ?? []).some(
		(tag) => tag.prefix?.toLowerCase().includes(q) || tag.suffix?.toLowerCase().includes(q),
	);
}
