// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {addTestPersona} from '@app/features/persona/state/__fixtures__/PersonaTestFixtures';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {personaHintsForQuery, personaSearchApiParams} from '@app/features/search/utils/PersonaSearchFilters';
import {buildSearchSegmentsFromHints} from '@app/features/search/utils/SearchPrivacyUtils';
import {parseQuery} from '@app/features/search/utils/SearchQueryParser';
import type {SearchSegment} from '@app/features/search/utils/SearchSegmentManager';
import {parseSearchQueryWithSegments} from '@app/features/search/utils/SearchUtils';
import type {ChannelPersonaMentionItem} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterEach, describe, expect, it, vi} from 'vitest';

const stubs = vi.hoisted(() => ({
	mentionItems: [] as Array<ChannelPersonaMentionItem>,
	usersByTag: new Map<string, {id: string}>(),
}));

/** The real store, with one member answered by the test. */
function overriding<T extends object>(target: T, property: PropertyKey, value: unknown): T {
	return Object.create(target, {[property]: {value}}) as T;
}

vi.mock('@app/features/lexical/composer/useAutocompletePersonaSearch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/lexical/composer/useAutocompletePersonaSearch')>()),
	getCachedPersonaMentionItems: () => stubs.mentionItems,
}));

vi.mock('@app/features/user/state/Users', async (importOriginal) => {
	const original = await importOriginal<typeof import('@app/features/user/state/Users')>();
	return {
		...original,
		default: overriding(original.default, 'getUserByTag', (tag: string) => stubs.usersByTag.get(tag)),
	};
});

vi.mock('@app/features/app/state/RuntimeConfig', async (importOriginal) => {
	const original = await importOriginal<typeof import('@app/features/app/state/RuntimeConfig')>();
	return {...original, default: overriding(original.default, 'usesUniqueUsernames', false)};
});

function otherPersona(id: string, name: string): ChannelPersonaMentionItem {
	return {
		id,
		name,
		visibility: 'public',
		use_count: 0,
		owner_user_id: '700',
		owner_username: 'other',
	};
}

function personaSegment(filterKey: string, id: string, displayText: string, start = 0): SearchSegment {
	return {type: 'persona', filterKey, id, displayText, start, end: start + displayText.length};
}

afterEach(() => {
	PersonaStore.reset();
	stubs.mentionItems = [];
	stubs.usersByTag.clear();
});

describe('personas in the parsed query', () => {
	it('narrows from: to a picked persona', () => {
		const params = parseQuery('from:Ash', {personasByName: {Ash: '501'}});

		expect(params.personaId).toEqual(['501']);
		expect(params.authorId).toBeUndefined();
	});

	it('excludes a persona and filters on mentioned personas', () => {
		const params = parseQuery('-from:Ash mentions:Bo -mentions:Cy', {
			personasByName: {Ash: '501', Bo: '502', Cy: '503'},
		});

		expect(params.excludePersonaId).toEqual(['501']);
		expect(params.personaMentions).toEqual(['502']);
		expect(params.excludePersonaMentions).toEqual(['503']);
	});

	it('does not take a picked persona for an account of the same name', () => {
		stubs.usersByTag.set('ash#0001', {id: '900'});

		const picked = parseQuery('from:ash#0001', {personasByName: {'ash#0001': '501'}});
		expect(picked.personaId).toEqual(['501']);
		expect(picked.authorId).toBeUndefined();

		addTestPersona(PersonaStore, {id: '501', name: 'ash#0001'});
		const typed = parseQuery('from:ash#0001');
		expect(typed.authorId).toEqual(['900']);
		expect(typed.personaId).toBeUndefined();
	});

	it('resolves a typed name to the one known persona with that name', () => {
		const own = addTestPersona(PersonaStore, {name: 'Ash'});
		stubs.mentionItems = [otherPersona('601', 'Ember')];

		expect(parseQuery('from:ash').personaId).toEqual([own.id]);
		expect(parseQuery('mentions:Ember').personaMentions).toEqual(['601']);
	});

	it('leaves a typed name that two known personas share, or that nobody has, without a filter', () => {
		addTestPersona(PersonaStore, {name: 'Ash'});
		stubs.mentionItems = [otherPersona('601', 'Ash')];

		const shared = parseQuery('from:Ash');
		expect(shared.personaId).toBeUndefined();
		expect(shared.authorId).toBeUndefined();
		expect(parseQuery('from:Nobody').personaId).toBeUndefined();
	});
});

describe('persona segments', () => {
	it('apply the persona they carry', () => {
		const query = 'from:"Ash Grey" hello';
		const params = parseSearchQueryWithSegments(query, [personaSegment('from', '501', 'from:"Ash Grey"')]);

		expect(params.personaId).toEqual(['501']);
		expect(params.content).toBe('hello');
	});

	it('are rebuilt from the hints a history entry stored', () => {
		const query = 'from:"Ash Grey" -mentions:Bo';
		const segments = buildSearchSegmentsFromHints(query, {personasByName: {'Ash Grey': '501', Bo: '502'}});

		expect(segments).toEqual([
			personaSegment('from', '501', 'from:"Ash Grey"'),
			personaSegment('-mentions', '502', '-mentions:Bo', 16),
		]);
	});

	it('give the parser their names as hints', () => {
		const hints = personaHintsForQuery({query: 'from:Bo', hints: {personasByName: {Bo: '502'}}, ts: 0}, [
			personaSegment('from', '501', 'from:"Ash Grey"'),
		]);

		expect(hints).toEqual({personasByName: {Bo: '502', 'Ash Grey': '501'}});
	});
});

describe('personaSearchApiParams', () => {
	it('names the request fields the server reads', () => {
		expect(
			personaSearchApiParams({
				personaId: ['1'],
				excludePersonaId: ['2'],
				personaMentions: ['3'],
				excludePersonaMentions: ['4'],
			}),
		).toEqual({
			persona_id: ['1'],
			exclude_persona_id: ['2'],
			persona_mentions: ['3'],
			exclude_persona_mentions: ['4'],
		});
	});
});
