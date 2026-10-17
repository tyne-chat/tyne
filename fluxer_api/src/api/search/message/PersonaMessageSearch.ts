// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Persona filters for message search (tyne#46).
 *
 * Each message's search document also records the persona it was sent as and the personas it
 * mentions, by ID only, so renaming a persona needs no reindex. `from:` and `mentions:` can then
 * name a persona as well as an account. An account keeps matching every message it sent, as any
 * of its personas, and every mention of any of its personas: those are the account's messages and
 * mentions of the account (the mention parser counts `<@user:persona>` as a mention of the user).
 */

import type {Message} from '@app/api/models/Message';
import {extractPersonaMentions} from '@app/api/persona/PersonaMentions';
import {
	type MeilisearchFilter,
	meiliAndTerms,
	meiliExcludeAny,
	meiliTermFilter,
} from '@app/api/search/meilisearch/MeilisearchFilterUtils';
import type {MessageSearchFilters} from '@fluxer/schema/src/contracts/search/SearchDocumentTypes';
import type {MessageSearchRequest} from '@fluxer/schema/src/domains/message/MessageRequestSchemas';

declare module '@fluxer/schema/src/contracts/search/SearchDocumentTypes' {
	interface MessageSearchFilters {
		/**
		 * Set instead of `authorId` when personas are named: a message matches if it is from any of
		 * the accounts or any of the personas.
		 */
		authorOrPersona?: {authorIds: Array<string>; personaIds: Array<string>};
		excludePersonaIds?: Array<string>;
		personaMentions?: Array<string>;
		excludePersonaMentions?: Array<string>;
	}
}

export const PERSONA_ID_FIELD = 'personaId';
export const MENTIONED_PERSONA_IDS_FIELD = 'mentionedPersonaIds';

export interface PersonaSearchFields {
	personaId: string | null;
	mentionedPersonaIds: Array<string>;
}

/**
 * The personas mentioned in message texts, in the `<@user:persona>` form both clients write.
 * Mentions inside code are left out, as the mention parser does.
 *
 * The persona is read from the text rather than checked against the message's mentioned users:
 * messages sent before the server parsed this form store no mentioned users for it, and the
 * mention is shown in them all the same.
 */
export function extractMentionedPersonaIds(contents: Iterable<string | null | undefined>): Array<string> {
	const ids: Array<string> = [];
	for (const {personaId} of extractPersonaMentions(contents)) {
		if (!ids.includes(personaId)) ids.push(personaId);
	}
	return ids;
}

/** Spread into each message's search document. Forwarded messages also count the mentions in what they forward, as upstream does for users. */
export function personaSearchFields(
	message: Pick<Message, 'personaId' | 'content' | 'reference' | 'messageSnapshots'>,
): PersonaSearchFields {
	const contents = [message.content];
	if (message.reference?.type === 1) {
		for (const snapshot of message.messageSnapshots) {
			contents.push(snapshot.content);
		}
	}
	return {
		personaId: message.personaId != null ? message.personaId.toString() : null,
		mentionedPersonaIds: extractMentionedPersonaIds(contents),
	};
}

/** Called at the end of upstream's `buildMessageSearchFilters`. */
export function applyPersonaSearchFilters(filters: MessageSearchFilters, searchParams: MessageSearchRequest): void {
	const personaIds = toStrings(searchParams.persona_id);
	if (personaIds.length > 0) {
		filters.authorOrPersona = {authorIds: filters.authorId ?? [], personaIds};
		delete filters.authorId;
	}
	const excludePersonaIds = toStrings(searchParams.exclude_persona_id);
	if (excludePersonaIds.length > 0) {
		filters.excludePersonaIds = excludePersonaIds;
	}
	const personaMentions = toStrings(searchParams.persona_mentions);
	if (personaMentions.length > 0) {
		filters.personaMentions = personaMentions;
	}
	const excludePersonaMentions = toStrings(searchParams.exclude_persona_mentions);
	if (excludePersonaMentions.length > 0) {
		filters.excludePersonaMentions = excludePersonaMentions;
	}
}

/** Called at the end of upstream's Meilisearch message filter builder; each clause is ANDed with upstream's. */
export function buildPersonaMessageFilters(filters: MessageSearchFilters): Array<MeilisearchFilter> {
	const clauses: Array<MeilisearchFilter> = [];
	if (filters.authorOrPersona) {
		const {authorIds, personaIds} = filters.authorOrPersona;
		const either = [
			...authorIds.map((id) => meiliTermFilter('authorId', id)),
			...personaIds.map((id) => meiliTermFilter(PERSONA_ID_FIELD, id)),
		];
		clauses.push(`(${either.join(' OR ')})`);
	}
	if (filters.excludePersonaIds) {
		clauses.push(...meiliExcludeAny(PERSONA_ID_FIELD, filters.excludePersonaIds));
	}
	if (filters.personaMentions) {
		clauses.push(...meiliAndTerms(MENTIONED_PERSONA_IDS_FIELD, filters.personaMentions));
	}
	if (filters.excludePersonaMentions) {
		clauses.push(...meiliExcludeAny(MENTIONED_PERSONA_IDS_FIELD, filters.excludePersonaMentions));
	}
	return clauses;
}

function toStrings(ids: Array<bigint> | undefined): Array<string> {
	return ids ? [...new Set(ids.map((id) => id.toString()))] : [];
}
