// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Personas in message search (tyne#46): `from:` and `mentions:` accept a persona as well as an
 * account. An account keeps matching all of its messages and mentions, whichever persona they were
 * sent as or name; a persona narrows to that persona.
 *
 * A persona picked from the suggestions becomes a `persona` search segment carrying its ID, and its
 * name is remembered in the search hints so a search run again from history keeps it. A persona
 * name typed without picking it is used when no account has that name and exactly one known persona
 * does (the user's own personas, and the personas fetched for mention suggestions).
 */

import type {SearchHints as SearchBarHints} from '@app/features/channel/components/message_search_bar/MessageSearchBarTypes';
import {getCachedPersonaMentionItems} from '@app/features/lexical/composer/useAutocompletePersonaSearch';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {SearchHistoryEntry} from '@app/features/search/state/SearchHistory';
import type {ParsedToken, SearchHints} from '@app/features/search/utils/SearchQueryParser';
import type {SearchSegment} from '@app/features/search/utils/SearchSegmentManager';
import type {MessageSearchParams} from '@app/features/search/utils/SearchUtils';

declare module '@app/features/search/utils/SearchUtils' {
	interface MessageSearchParams {
		personaId?: Array<string>;
		excludePersonaId?: Array<string>;
		personaMentions?: Array<string>;
		excludePersonaMentions?: Array<string>;
	}
}

declare module '@app/features/search/utils/SearchQueryParser' {
	interface SearchHints {
		/** Persona IDs by the name shown in the query, as `usersByTag` does for accounts. */
		personasByName?: Record<string, string>;
	}
}

declare module '@app/features/channel/components/message_search_bar/MessageSearchBarTypes' {
	interface SearchHints {
		personasByName?: Record<string, string>;
	}
}

type PersonaFilterKey = 'from' | 'mentions';

function addUnique(values: Array<string> | undefined, value: string): Array<string> {
	if (values == null) return [value];
	return values.includes(value) ? values : [...values, value];
}

function addPersona(params: MessageSearchParams, filterKey: PersonaFilterKey, isExclude: boolean, personaId: string) {
	if (filterKey === 'from') {
		if (isExclude) params.excludePersonaId = addUnique(params.excludePersonaId, personaId);
		else params.personaId = addUnique(params.personaId, personaId);
		return;
	}
	if (isExclude) params.excludePersonaMentions = addUnique(params.excludePersonaMentions, personaId);
	else params.personaMentions = addUnique(params.personaMentions, personaId);
}

/** The one known persona with this name (any case), or null when there is none or more than one. */
export function resolveKnownPersonaByName(name: string): string | null {
	const wanted = name.trim().toLowerCase();
	if (wanted === '') return null;
	const ids = new Set<string>();
	for (const persona of PersonaStore.personas) {
		if (persona.name.trim().toLowerCase() === wanted) ids.add(persona.id);
	}
	for (const persona of getCachedPersonaMentionItems()) {
		if (persona.name.trim().toLowerCase() === wanted) ids.add(persona.id);
	}
	return ids.size === 1 ? [...ids][0]! : null;
}

/**
 * True when the value is a persona picked from the suggestions (and no account was picked under the
 * same name), so the parser does not look it up as an account: a persona called "ash" must not
 * become the account @ash. Names typed without picking are still looked up as accounts first.
 */
export function isPickedPersona(value: string, hints?: SearchHints): boolean {
	const name = value.trim();
	return hints?.personasByName?.[name] != null && hints.usersByTag?.[name] == null;
}

/**
 * Called by the query parser for a `from:` or `mentions:` value that did not name an account.
 */
export function applyPersonaSearchValue(
	params: MessageSearchParams,
	filterKey: PersonaFilterKey,
	value: string,
	isExclude: boolean,
	hints?: SearchHints,
): void {
	const name = value.trim();
	const personaId = hints?.personasByName?.[name] ?? resolveKnownPersonaByName(name);
	if (personaId != null) addPersona(params, filterKey, isExclude, personaId);
}

/** Called for each search segment; returns true when the segment was a persona's and has been applied. */
export function applyPersonaSegment(params: MessageSearchParams, segment: SearchSegment): boolean {
	if (segment.type !== 'persona') return false;
	const isExclude = segment.filterKey.startsWith('-');
	const filterKey = isExclude ? segment.filterKey.slice(1) : segment.filterKey;
	if (filterKey === 'from' || filterKey === 'mentions') {
		addPersona(params, filterKey, isExclude, segment.id);
	}
	return true;
}

/** The persona fields of the search request. */
export function personaSearchApiParams(params: MessageSearchParams): Record<string, Array<string> | undefined> {
	return {
		persona_id: params.personaId,
		exclude_persona_id: params.excludePersonaId,
		persona_mentions: params.personaMentions,
		exclude_persona_mentions: params.excludePersonaMentions,
	};
}

/** Persona hints for parsing a query: those stored with its history entry, overridden by the persona segments in it. */
export function personaHintsForQuery(
	entry: SearchHistoryEntry | undefined,
	segments: ReadonlyArray<SearchSegment>,
): Pick<SearchHints, 'personasByName'> {
	const personasByName: Record<string, string> = {...(entry?.hints?.personasByName ?? {})};
	for (const segment of segments) {
		if (segment.type !== 'persona') continue;
		const name = segmentValue(segment.displayText);
		if (name) personasByName[name] = segment.id;
	}
	return Object.keys(personasByName).length > 0 ? {personasByName} : {};
}

/** The persona segment for a `from:`/`mentions:` token of a history entry, when its hints name a persona and no account. */
export function personaSegmentFromHints(
	hints: SearchHints,
	token: ParsedToken,
	filterKey: string,
	value: string,
): SearchSegment | null {
	if (hints.usersByTag?.[value]) return null;
	const personaId = hints.personasByName?.[value];
	if (!personaId) return null;
	return {type: 'persona', filterKey, id: personaId, displayText: token.raw, start: token.start, end: token.end};
}

/** Remembers a picked persona's name in the search bar's hints, which go into search history. */
export function rememberPersonaHint(hints: SearchBarHints, name: string, personaId: string): void {
	hints.personasByName = {...(hints.personasByName ?? {}), [name]: personaId};
}

function segmentValue(displayText: string): string | null {
	const colonIndex = displayText.indexOf(':');
	if (colonIndex === -1) return null;
	const raw = displayText.slice(colonIndex + 1).trim();
	if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
	return raw.length > 0 ? raw : null;
}
