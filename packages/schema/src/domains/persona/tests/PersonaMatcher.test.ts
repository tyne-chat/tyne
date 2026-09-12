// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {matchPersona, type PersonaLike, type PersonaTagLike, previewPersona} from '../PersonaMatcher';

describe('PersonaMatcher', () => {
	const alice: PersonaLike = {
		id: 'alice-id',
		name: 'Alice',
		persona_tags: [{prefix: '[', suffix: ']'}],
	};

	const bob: PersonaLike = {
		id: 'bob-id',
		name: 'Bob',
		persona_tags: [
			{prefix: '[[', suffix: ']]'},
			{prefix: 'B:', suffix: ''},
		],
	};

	const charlie: PersonaLike = {
		id: 'charlie-id',
		name: 'Charlie',
		persona_tags: [{prefix: '', suffix: '-C'}],
	};

	const disabledPersona: PersonaLike = {
		id: 'disabled-id',
		name: 'Disabled',
		auto_tag_disabled: true,
		persona_tags: [{prefix: '{', suffix: '}'}],
	};

	const personas = [alice, bob, charlie, disabledPersona];

	it('matches bracket prefix and suffix correctly and trims inner content', () => {
		const result = matchPersona('[Hello world!]', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Alice');
		expect(result.strippedContent).toBe('Hello world!');
	});

	it('prefers the longest match when multiple tags match', () => {
		// Both Alice ([...]) and Bob ([[...]]) could match [[Hello]], but Bob's tag is longer
		const result = matchPersona('[[Hello]]', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Hello');
	});

	it('matches prefix-only tags', () => {
		const result = matchPersona('B: Good morning everyone', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Good morning everyone');
	});

	it('matches suffix-only tags', () => {
		const result = matchPersona('Good morning everyone -C', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Charlie');
		expect(result.strippedContent).toBe('Good morning everyone');
	});

	it('ignores disabled personas', () => {
		const result = matchPersona('{Disabled text}', personas);
		expect(result.matched).toBe(false);
		expect(result.strippedContent).toBe('{Disabled text}');
	});

	it('does not match empty inner content', () => {
		const result1 = matchPersona('[]', personas);
		expect(result1.matched).toBe(false);

		const result2 = matchPersona('[   ]', personas);
		expect(result2.matched).toBe(false);
	});

	it('matches just the persona prefix when hasAttachments is true', () => {
		// Just prefix of Alice ('[')
		const res1 = matchPersona('[', personas, null, true);
		expect(res1.matched).toBe(true);
		expect(res1.persona?.name).toBe('Alice');
		expect(res1.strippedContent).toBe('');

		// Just prefix of Alice with trailing space ('[ ')
		const res2 = matchPersona('[ ', personas, null, true);
		expect(res2.matched).toBe(true);
		expect(res2.persona?.name).toBe('Alice');
		expect(res2.strippedContent).toBe('');

		// Just prefix-only tag of Bob ('B:')
		const res3 = matchPersona('B:', personas, null, true);
		expect(res3.matched).toBe(true);
		expect(res3.persona?.name).toBe('Bob');
		expect(res3.strippedContent).toBe('');

		// Prefix-only tag of Bob with space ('B: ')
		const res4 = matchPersona('B: ', personas, null, true);
		expect(res4.matched).toBe(true);
		expect(res4.persona?.name).toBe('Bob');
		expect(res4.strippedContent).toBe('');

		// Prefix and suffix with empty inner content ('[]') with attachments
		const res5 = matchPersona('[]', personas, null, true);
		expect(res5.matched).toBe(true);
		expect(res5.persona?.name).toBe('Alice');
		expect(res5.strippedContent).toBe('');

		// Prefix and suffix with whitespace inner content ('[   ]') with attachments
		const res6 = matchPersona('[   ]', personas, null, true);
		expect(res6.matched).toBe(true);
		expect(res6.persona?.name).toBe('Alice');
		expect(res6.strippedContent).toBe('');

		// Prefix-only tag of persona configured with trailing space (e.g. 'P: ')
		const dave: PersonaLike = {
			id: 'dave-id',
			name: 'Dave',
			persona_tags: [{prefix: 'D: ', suffix: ''}],
		};
		const resDave = matchPersona('D:', [dave], null, true);
		expect(resDave.matched).toBe(true);
		expect(resDave.persona?.name).toBe('Dave');
		expect(resDave.strippedContent).toBe('');

		// But when hasAttachments is false, prefix-only or empty content does NOT match
		expect(matchPersona('[', personas, null, false).matched).toBe(false);
		expect(matchPersona('B:', personas, null, false).matched).toBe(false);
		expect(matchPersona('[]', personas, null, false).matched).toBe(false);
	});

	it('escapes persona tag matching when prefixed with backslash \\ while a persona is latched', () => {
		const result = matchPersona('\\[Hello world!]', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('[Hello world!]');
	});

	it('does not escape, strip slashes, or clear latch when root account is selected (no active latched persona)', () => {
		// Single slash with message
		const res1 = matchPersona('\\ hello', personas);
		expect(res1.matched).toBe(false);
		expect(res1.wasEscaped).toBeFalsy();
		expect(res1.strippedContent).toBe('\\ hello');

		// Double slash with message
		const res2 = matchPersona('\\\\ hello', personas);
		expect(res2.matched).toBe(false);
		expect(res2.wasEscaped).toBeFalsy();
		expect(res2.clearedLatch).toBeFalsy();
		expect(res2.strippedContent).toBe('\\\\ hello');

		// Standalone double slash
		const res3 = matchPersona('\\\\', personas);
		expect(res3.matched).toBe(false);
		expect(res3.wasEscaped).toBeFalsy();
		expect(res3.clearedLatch).toBeFalsy();
		expect(res3.strippedContent).toBe('\\\\');

		// Emoticon or shrug
		const res4 = matchPersona('\\o/', personas);
		expect(res4.matched).toBe(false);
		expect(res4.wasEscaped).toBeFalsy();
		expect(res4.strippedContent).toBe('\\o/');
	});

	it('detects latch clearing command \\\\ when a persona is latched', () => {
		const result = matchPersona('\\\\', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.clearedLatch).toBe(true);
	});

	it('sends under active latched persona when no tags match', () => {
		const result = matchPersona('Plain message with no tags', personas, 'alice-id');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Alice');
		expect(result.strippedContent).toBe('Plain message with no tags');
	});

	it('allows explicit tags to override active latched persona', () => {
		const result = matchPersona('B: Speaking as Bob', personas, 'alice-id');
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Bob');
		expect(result.strippedContent).toBe('Speaking as Bob');
	});

	it('allows escape backslash to bypass active latched persona', () => {
		const result = matchPersona('\\Plain message meant for root', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.strippedContent).toBe('Plain message meant for root');
		expect(result.clearedLatch).toBeFalsy();
	});

	it('clears latch and strips prefix when double backslash has message', () => {
		const result = matchPersona('\\\\ Plain message with unlatch', personas, 'alice-id');
		expect(result.matched).toBe(false);
		expect(result.wasEscaped).toBe(true);
		expect(result.clearedLatch).toBe(true);
		expect(result.strippedContent).toBe('Plain message with unlatch');
	});

	it('works with PersonaTagLike interface', () => {
		const tag: PersonaTagLike = {prefix: '[', suffix: ']'};
		expect(tag.prefix).toBe('[');
		const result = matchPersona('[Hello via matchPersona]', personas);
		expect(result.matched).toBe(true);
		expect(result.persona?.name).toBe('Alice');
		expect(result.strippedContent).toBe('Hello via matchPersona');
	});

	describe('previewPersona', () => {
		it('matches completed tags even when inner text is empty or just typed', () => {
			const res1 = previewPersona('[]', personas);
			expect(res1.persona?.name).toBe('Alice');
			expect(res1.isFromTag).toBe(true);

			const res2 = previewPersona('[   ]', personas);
			expect(res2.persona?.name).toBe('Alice');
			expect(res2.isFromTag).toBe(true);

			const res3 = previewPersona('B:', personas);
			expect(res3.persona?.name).toBe('Bob');
			expect(res3.isFromTag).toBe(true);

			const res4 = previewPersona('B: ', personas);
			expect(res4.persona?.name).toBe('Bob');
			expect(res4.isFromTag).toBe(true);

			const res5 = previewPersona('[Hello]', personas);
			expect(res5.persona?.name).toBe('Alice');
			expect(res5.isFromTag).toBe(true);
		});

		it('does not match incomplete tags and reverts to active persona or root', () => {
			// Incomplete prefix without suffix
			const res1 = previewPersona('[Hello', personas);
			expect(res1.persona).toBeNull();
			expect(res1.isFromTag).toBe(false);

			// Incomplete prefix without suffix with active latched persona
			const res2 = previewPersona('[Hello', personas, 'bob-id');
			expect(res2.persona?.name).toBe('Bob');
			expect(res2.isFromTag).toBe(false);

			// Completely untagged message with active latched persona
			const res3 = previewPersona('Hello there', personas, 'bob-id');
			expect(res3.persona?.name).toBe('Bob');
			expect(res3.isFromTag).toBe(false);

			// Completely untagged message without active latched persona (root account)
			const res4 = previewPersona('Hello there', personas, null);
			expect(res4.persona).toBeNull();
			expect(res4.isFromTag).toBe(false);
		});

		it('switches between personas in real-time as tags change', () => {
			// Start with Alice tag
			const res1 = previewPersona('[Hello]', personas);
			expect(res1.persona?.name).toBe('Alice');

			// Change to Bob tag
			const res2 = previewPersona('[[Hello]]', personas);
			expect(res2.persona?.name).toBe('Bob');

			// Change to Charlie tag
			const res3 = previewPersona('Hello -C', personas);
			expect(res3.persona?.name).toBe('Charlie');

			// Remove tag entirely
			const res4 = previewPersona('Hello', personas);
			expect(res4.persona).toBeNull();
		});

		it('reverts to root when escaped with backslash', () => {
			const res1 = previewPersona('\\ [Hello]', personas, 'bob-id');
			expect(res1.persona).toBeNull();
			expect(res1.isFromTag).toBe(false);

			const res2 = previewPersona('\\\\', personas, 'bob-id');
			expect(res2.persona).toBeNull();
			expect(res2.isFromTag).toBe(false);
		});
	});
});
