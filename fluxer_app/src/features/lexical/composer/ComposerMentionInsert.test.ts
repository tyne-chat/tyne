// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

import type {ComposerHandle} from '@app/features/lexical/composer/ComposerHandle';
import {insertComposerMention} from '@app/features/lexical/composer/ComposerInsertion';

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));

const MENTION = {id: 'user-1', display: '@Fox', wire: '<@user-1:persona-1>'};

function handleWith(display: string, selection: {start: number; end: number} | null) {
	const replaceRange = vi.fn();
	const handle = {
		getDisplayValue: () => display,
		getSegments: () => [],
		getSelection: () => selection,
		replaceRange,
	} as unknown as ComposerHandle;
	return {handle, replaceRange};
}

describe('insertComposerMention', () => {
	it('goes at the caret, not at the end of the text', () => {
		const {handle, replaceRange} = handleWith('hello there', {start: 6, end: 6});

		expect(insertComposerMention(handle, MENTION)).toBe(true);

		const [start, end, payload] = replaceRange.mock.calls[0];
		expect([start, end]).toEqual([6, 6]);
		expect(payload).toEqual({kind: 'mention', mentionType: 'user', ...MENTION});
	});

	it('adds a space before it where it would touch the text, and never after it', () => {
		const inWord = handleWith('hello', {start: 2, end: 2});
		insertComposerMention(inWord.handle, MENTION);
		expect(inWord.replaceRange.mock.calls[0][3]).toEqual({leading: true, trailing: false});

		const afterSpace = handleWith('hello there', {start: 6, end: 6});
		insertComposerMention(afterSpace.handle, MENTION);
		expect(afterSpace.replaceRange.mock.calls[0][3]).toEqual({leading: false, trailing: false});

		const atStart = handleWith('hello', {start: 0, end: 0});
		insertComposerMention(atStart.handle, MENTION);
		expect(atStart.replaceRange.mock.calls[0][3]).toEqual({leading: false, trailing: false});
	});

	it('replaces a selection', () => {
		const {handle, replaceRange} = handleWith('hello there', {start: 6, end: 11});

		insertComposerMention(handle, MENTION);

		expect(replaceRange.mock.calls[0].slice(0, 2)).toEqual([6, 11]);
	});

	it('goes at the end with no caret to go by', () => {
		const {handle, replaceRange} = handleWith('hello', null);

		insertComposerMention(handle, MENTION);

		expect(replaceRange.mock.calls[0].slice(0, 2)).toEqual([5, 5]);
	});

	it('stops at the length limit', () => {
		const {handle, replaceRange} = handleWith('hello', {start: 5, end: 5});
		const onExceedMaxLength = vi.fn();

		expect(insertComposerMention(handle, MENTION, {maxWireLength: 8, onExceedMaxLength})).toBe(false);

		expect(onExceedMaxLength).toHaveBeenCalledTimes(1);
		expect(replaceRange).not.toHaveBeenCalled();
	});
});
