// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {matchProxy, type PersonaLike} from '../ProxyMatcher';

describe('ProxyMatcher', () => {
	const alice: PersonaLike = {
		id: 'alice-id',
		name: 'Alice',
		proxy_tags: [{prefix: '[', suffix: ']'}],
	};

	const bob: PersonaLike = {
		id: 'bob-id',
		name: 'Bob',
		proxy_tags: [
			{prefix: '[[', suffix: ']]'},
			{prefix: 'B:', suffix: ''},
		],
	};

	const charlie: PersonaLike = {
		id: 'charlie-id',
		name: 'Charlie',
		proxy_tags: [{prefix: '', suffix: '-C'}],
	};

	const disabledPersona: PersonaLike = {
		id: 'disabled-id',
		name: 'Disabled',
		auto_proxy_disabled: true,
		proxy_tags: [{prefix: '{', suffix: '}'}],
	};

	const personas = [alice, bob, charlie, disabledPersona];

	it('matches bracket prefix and suffix correctly and trims inner content', () => {
		const result = matchProxy('[Hello world!]', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Alice');
		expect(result.strippedContent).toBe('Hello world!');
	});

	it('prefers the longest match when multiple tags match', () => {
		// Both Alice ([...]) and Bob ([[...]]) could match [[Hello]], but Bob's tag is longer
		const result = matchProxy('[[Hello]]', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Hello');
	});

	it('matches prefix-only tags', () => {
		const result = matchProxy('B: Good morning everyone', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Good morning everyone');
	});

	it('matches suffix-only tags', () => {
		const result = matchProxy('Good morning everyone -C', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Charlie');
		expect(result.strippedContent).toBe('Good morning everyone');
	});

	it('ignores disabled personas', () => {
		const result = matchProxy('{Disabled text}', personas);
		expect(result.matched).toBe(false);
		expect(result.strippedContent).toBe('{Disabled text}');
	});

	it('does not match empty inner content', () => {
		const result1 = matchProxy('[]', personas);
		expect(result1.matched).toBe(false);

		const result2 = matchProxy('[   ]', personas);
		expect(result2.matched).toBe(false);
	});

	it('escapes proxy matching when prefixed with backslash \\ while a persona is latched', () => {
		const result = matchProxy('\\[Hello world!]', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('[Hello world!]');
	});

	it('does not escape, strip slashes, or clear latch when root account is selected (no active latched persona)', () => {
		// Single slash with message
		const res1 = matchProxy('\\ hello', personas);
		expect(res1.matched).toBe(false);
		expect(res1.wasEscaped).toBeFalsy();
		expect(res1.strippedContent).toBe('\\ hello');

		// Double slash with message
		const res2 = matchProxy('\\\\ hello', personas);
		expect(res2.matched).toBe(false);
		expect(res2.wasEscaped).toBeFalsy();
		expect(res2.clearedLatch).toBeFalsy();
		expect(res2.strippedContent).toBe('\\\\ hello');

		// Standalone double slash
		const res3 = matchProxy('\\\\', personas);
		expect(res3.matched).toBe(false);
		expect(res3.wasEscaped).toBeFalsy();
		expect(res3.clearedLatch).toBeFalsy();
		expect(res3.strippedContent).toBe('\\\\');

		// Emoticon or shrug
		const res4 = matchProxy('\\o/', personas);
		expect(res4.matched).toBe(false);
		expect(res4.wasEscaped).toBeFalsy();
		expect(res4.strippedContent).toBe('\\o/');
	});

	it('detects latch clearing command \\\\ when a persona is latched', () => {
		const result = matchProxy('\\\\', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.clearedLatch).toBe(true);
	});

	it('proxies under active latched persona when no tags match', () => {
		const result = matchProxy('Plain message with no tags', personas, 'alice-id');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Alice');
		expect(result.strippedContent).toBe('Plain message with no tags');
	});

	it('allows explicit tags to override active latched persona', () => {
		const result = matchProxy('B: Speaking as Bob', personas, 'alice-id');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Speaking as Bob');
	});

	it('allows escape backslash to bypass active latched persona', () => {
		const result = matchProxy('\\Plain message meant for root', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Plain message meant for root');
		expect(result.clearedLatch).toBeFalsy();
	});

	it('clears latch and strips prefix when double backslash has message', () => {
		const result = matchProxy('\\\\ Plain message with unlatch', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.clearedLatch).toBe(true);
		expect(result.strippedContent).toBe('Plain message with unlatch');
	});
});
