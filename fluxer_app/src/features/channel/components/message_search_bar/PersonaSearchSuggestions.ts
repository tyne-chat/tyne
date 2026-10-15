// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Persona suggestions in the message search bar (tyne#46). For `from:` and `mentions:`, and for a
 * plain word that could become one of them, the bar suggests personas as well as accounts: the
 * same personas the composer suggests for an @-mention in this channel, that is every persona of
 * the user's own and the public and unlisted personas of the channel's other members.
 */

import type {
	AutocompleteType,
	PlaintextAutocompleteRow,
	SearchHints,
} from '@app/features/channel/components/message_search_bar/MessageSearchBarTypes';
import {
	isUserFilterKey,
	replaceSearchTokenAtCursor,
	resolveMessageSearchCurrentWord,
	type SearchTokenReplacementResult,
} from '@app/features/channel/components/message_search_bar/MessageSearchBarUtils';
import type {Channel} from '@app/features/channel/models/Channel';
import {useAutocompletePersonaSearch} from '@app/features/lexical/composer/useAutocompletePersonaSearch';
import type {LexicalSearchInputHandle} from '@app/features/lexical/search/LexicalSearchInput';
import {rememberPersonaHint} from '@app/features/search/utils/PersonaSearchFilters';
import type {SearchSegment} from '@app/features/search/utils/SearchSegmentManager';
import type {SearchFilterOption} from '@app/features/search/utils/SearchUtils';
import type {ChannelPersonaMentionItem} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';

/** At most this many personas follow the accounts suggested for `from:` or `mentions:`. */
export const MAX_PERSONA_FILTER_SUGGESTIONS = 8;

export interface SearchPersonaOption {
	kind: 'persona';
	persona: ChannelPersonaMentionItem;
}

export interface PersonaSuggestionRow {
	kind: 'persona-suggestion';
	filterKey: string;
	persona: ChannelPersonaMentionItem;
}

const NO_PERSONAS: Array<ChannelPersonaMentionItem> = [];
const LEADING_QUOTE = /^["“”]/;

export function isSearchPersonaOption(option: unknown): option is SearchPersonaOption {
	return typeof option === 'object' && option !== null && 'kind' in option && option.kind === 'persona';
}

/** The word the personas are matched against, or '' when the bar is not suggesting accounts. */
export function resolvePersonaSearchTerm(
	autocompleteType: AutocompleteType,
	currentFilter: SearchFilterOption | null,
	value: string,
	cursorPosition: number,
): string {
	const currentWord = resolveMessageSearchCurrentWord({value, cursorPosition});
	if (autocompleteType === 'users' && currentFilter != null && isUserFilterKey(currentFilter.key)) {
		return currentWord.slice(currentFilter.syntax.length).trim().replace(LEADING_QUOTE, '');
	}
	if (autocompleteType === 'plaintext') {
		return currentWord.trim();
	}
	return '';
}

export function useSearchPersonaSuggestions({
	autocompleteType,
	currentFilter,
	value,
	inputRef,
	channel,
}: {
	autocompleteType: AutocompleteType;
	currentFilter: SearchFilterOption | null;
	value: string;
	inputRef: React.RefObject<LexicalSearchInputHandle | null>;
	channel: Channel | undefined;
}): Array<ChannelPersonaMentionItem> {
	const cursorPosition = inputRef.current?.selectionStart ?? value.length;
	const term = resolvePersonaSearchTerm(autocompleteType, currentFilter, value, cursorPosition);
	const personas = useAutocompletePersonaSearch({
		triggerType: term !== '' ? 'mention' : null,
		matchedText: term,
		channelId: channel?.id,
		guildId: channel?.guildId,
	});
	return term !== '' ? personas : NO_PERSONAS;
}

/** The options without the personas, for upstream's accounts section. */
export function withoutPersonaOptions<T>(options: ReadonlyArray<T>): Array<T> {
	return options.filter((option) => !isSearchPersonaOption(option));
}

/** The persona options that follow the account options for `from:` or `mentions:`. */
export function personaSearchOptions(personas: ReadonlyArray<ChannelPersonaMentionItem>): Array<SearchPersonaOption> {
	return personas.slice(0, MAX_PERSONA_FILTER_SUGGESTIONS).map((persona) => ({kind: 'persona', persona}));
}

/** Adds persona rows for one filter to the plain-word suggestions and returns how many it added. */
export function pushPersonaSuggestionRows(
	rows: Array<PlaintextAutocompleteRow>,
	filterKey: string,
	personas: ReadonlyArray<ChannelPersonaMentionItem>,
	limit: number,
): number {
	if (!isUserFilterKey(filterKey)) return 0;
	const picked = personas.slice(0, limit);
	for (const persona of picked) {
		rows.push({kind: 'persona-suggestion', filterKey, persona});
	}
	return picked.length;
}

/** Puts a picked persona into the query as a `persona` segment and remembers its name for search history. */
export function replaceTokenWithPersona({
	value,
	cursorPosition,
	currentSegments,
	filter,
	persona,
	hints,
}: {
	value: string;
	cursorPosition: number;
	currentSegments: ReadonlyArray<SearchSegment>;
	filter: SearchFilterOption;
	persona: ChannelPersonaMentionItem;
	hints: SearchHints;
}): SearchTokenReplacementResult {
	const replacement = replaceSearchTokenAtCursor({
		value,
		cursorPosition,
		currentSegments,
		syntax: filter.syntax,
		tokenValue: persona.name,
		addSpaceAfter: true,
		replacementSegment: {type: 'persona', filterKey: filter.key, id: persona.id},
	});
	rememberPersonaHint(hints, persona.name, persona.id);
	return replacement;
}
