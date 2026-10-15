// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PlaintextAutocompleteRow} from '@app/features/channel/components/message_search_bar/MessageSearchBarTypes';
import {
	isSearchPersonaOption,
	MAX_PERSONA_FILTER_SUGGESTIONS,
	personaSearchOptions,
	pushPersonaSuggestionRows,
	replaceTokenWithPersona,
	resolvePersonaSearchTerm,
	withoutPersonaOptions,
} from '@app/features/channel/components/message_search_bar/PersonaSearchSuggestions';
import type {SearchFilterOption} from '@app/features/search/utils/SearchUtils';
import type {ChannelPersonaMentionItem} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {describe, expect, it} from 'vitest';

const FROM: SearchFilterOption = {key: 'from', label: 'from:', description: '', syntax: 'from:', requiresValue: true};

function persona(id: string, name: string): ChannelPersonaMentionItem {
	return {id, name, visibility: 'unlisted', use_count: 0, owner_user_id: '700', owner_username: 'owner'};
}

describe('resolvePersonaSearchTerm', () => {
	it('matches personas against the value of from: and mentions:, and against a plain word', () => {
		expect(resolvePersonaSearchTerm('users', FROM, 'hello from:"as', 14)).toBe('as');
		expect(resolvePersonaSearchTerm('plaintext', null, 'ash', 3)).toBe('ash');
	});

	it('suggests no personas for other filters', () => {
		const inFilter: SearchFilterOption = {key: 'in', label: 'in:', description: '', syntax: 'in:'};
		expect(resolvePersonaSearchTerm('channels', inFilter, 'in:gen', 6)).toBe('');
		expect(resolvePersonaSearchTerm('history', null, '', 0)).toBe('');
	});
});

describe('persona options', () => {
	it('follow the accounts, at most a fixed number of them', () => {
		const many = Array.from({length: 12}, (_, i) => persona(String(500 + i), `P${i}`));
		const options = personaSearchOptions(many);

		expect(options).toHaveLength(MAX_PERSONA_FILTER_SUGGESTIONS);
		expect(options.every(isSearchPersonaOption)).toBe(true);
		expect(withoutPersonaOptions(['account', ...options])).toEqual(['account']);
	});

	it('are added to the plain-word suggestions for from: and mentions: only', () => {
		const rows: Array<PlaintextAutocompleteRow> = [];
		const personas = [persona('501', 'Ash'), persona('502', 'Ashley')];

		expect(pushPersonaSuggestionRows(rows, 'from', personas, 1)).toBe(1);
		expect(pushPersonaSuggestionRows(rows, 'in', personas, 3)).toBe(0);
		expect(rows).toEqual([{kind: 'persona-suggestion', filterKey: 'from', persona: personas[0]}]);
	});
});

describe('replaceTokenWithPersona', () => {
	it('puts the picked persona in as a segment and remembers its name', () => {
		const hints = {usersByTag: {}, channelsByName: {}};
		const result = replaceTokenWithPersona({
			value: 'hello from:as',
			cursorPosition: 13,
			currentSegments: [],
			filter: FROM,
			persona: persona('501', 'Ash Grey'),
			hints,
		});

		expect(result.newText).toBe('hello from:"Ash Grey" ');
		expect(result.newSegments).toEqual([
			{type: 'persona', filterKey: 'from', id: '501', displayText: 'from:"Ash Grey"', start: 6, end: 21},
		]);
		expect(hints).toEqual({usersByTag: {}, channelsByName: {}, personasByName: {'Ash Grey': '501'}});
	});
});
