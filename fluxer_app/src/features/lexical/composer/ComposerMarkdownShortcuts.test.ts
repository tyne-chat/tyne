// SPDX-License-Identifier: AGPL-3.0-or-later

import {registerComposerBlockquote} from '@app/features/lexical/composer/ComposerBlockquote';
import {registerComposerMarkdownHighlight} from '@app/features/lexical/composer/ComposerMarkdownHighlight';
import {registerComposerMarkdownShortcuts} from '@app/features/lexical/composer/ComposerMarkdownShortcuts';
import {$hydrateComposerFromDraft, $projectComposer} from '@app/features/lexical/composer/ComposerSerialization';
import {$captureSelectionOffsets, $selectComposerRange} from '@app/features/lexical/composer/composerOffsets';
import {DEFAULT_COMPOSER_MARKDOWN_FLAGS} from '@app/features/lexical/composer/markdownSpans';
import {ComposerBlockquoteLineNode} from '@app/features/lexical/composer/nodes/ComposerBlockquoteLineNode';
import {ComposerBlockquoteMarkerNode} from '@app/features/lexical/composer/nodes/ComposerBlockquoteMarkerNode';
import {ComposerCommandNode} from '@app/features/lexical/composer/nodes/ComposerCommandNode';
import {ComposerCustomEmojiNode} from '@app/features/lexical/composer/nodes/ComposerCustomEmojiNode';
import {ComposerMentionNode} from '@app/features/lexical/composer/nodes/ComposerMentionNode';
import {ComposerPlainSegmentNode} from '@app/features/lexical/composer/nodes/ComposerPlainSegmentNode';
import {ComposerStandardEmojiNode} from '@app/features/lexical/composer/nodes/ComposerStandardEmojiNode';
import {SlashOptionalHintNode} from '@app/features/lexical/composer/nodes/SlashOptionalHintNode';
import {SlashSeparatorNode} from '@app/features/lexical/composer/nodes/SlashSeparatorNode';
import {SlashSlotNode} from '@app/features/lexical/composer/nodes/SlashSlotNode';
import {SlashSlotPlaceholderNode} from '@app/features/lexical/composer/nodes/SlashSlotPlaceholderNode';
import {SyntaxMarkerNode} from '@app/features/lexical/composer/nodes/SyntaxMarkerNode';
import {createEditor, KEY_DOWN_COMMAND, type LexicalCommand, type LexicalEditor} from 'lexical';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/lexical/composer/nodes/ComposerMentionPill', () => ({ComposerMentionPill: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerCustomEmoji', () => ({ComposerCustomEmoji: () => null}));
vi.mock('@app/features/lexical/composer/nodes/ComposerStandardEmoji', () => ({ComposerStandardEmoji: () => null}));
vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));

const NODES = [
	ComposerMentionNode,
	ComposerCustomEmojiNode,
	ComposerStandardEmojiNode,
	ComposerPlainSegmentNode,
	ComposerCommandNode,
	SlashSlotNode,
	SlashSlotPlaceholderNode,
	SlashSeparatorNode,
	SlashOptionalHintNode,
	SyntaxMarkerNode,
	ComposerBlockquoteLineNode,
	ComposerBlockquoteMarkerNode,
];

const disposers: Array<() => void> = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()!();
	}
});

function createHarness(): LexicalEditor {
	const editor = createEditor({
		namespace: 'composer-markdown-shortcuts-test',
		nodes: NODES,
		onError: (error) => {
			throw error;
		},
	});
	disposers.push(
		registerComposerMarkdownHighlight(editor, DEFAULT_COMPOSER_MARKDOWN_FLAGS),
		registerComposerBlockquote(editor, DEFAULT_COMPOSER_MARKDOWN_FLAGS),
		registerComposerMarkdownShortcuts(editor),
	);
	return editor;
}

function update(editor: LexicalEditor, fn: () => void): void {
	editor.update(fn, {discrete: true});
}

function setComposer(editor: LexicalEditor, text: string, anchor?: number, focus?: number): void {
	update(editor, () => {
		$hydrateComposerFromDraft(text, []);
		if (anchor != null) {
			$selectComposerRange(anchor, focus == null ? anchor : focus);
		}
	});
}

function run<T>(editor: LexicalEditor, command: LexicalCommand<T>, payload: T): boolean {
	let handled = false;
	update(editor, () => {
		handled = editor.dispatchCommand(command, payload);
	});
	return handled;
}

function keyEvent(overrides: Record<string, unknown> = {}): KeyboardEvent {
	return {
		key: 'b',
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		isComposing: false,
		preventDefault: vi.fn(),
		...overrides,
	} as unknown as KeyboardEvent;
}

function getComposerState(editor: LexicalEditor) {
	return editor.getEditorState().read(() => ({
		wire: $projectComposer().wire,
		offsets: $captureSelectionOffsets(),
	}));
}

describe('ComposerMarkdownShortcuts', () => {
	it('does nothing on empty composer with collapsed selection on Ctrl+B and Ctrl+I', () => {
		const editor = createHarness();
		setComposer(editor, '', 0, 0);

		const bEvent = keyEvent({key: 'b', ctrlKey: true});
		run(editor, KEY_DOWN_COMMAND, bEvent);
		expect(getComposerState(editor)).toEqual({
			wire: '',
			offsets: {anchor: 0, focus: 0},
		});

		const iEvent = keyEvent({key: 'i', ctrlKey: true});
		run(editor, KEY_DOWN_COMMAND, iEvent);
		expect(getComposerState(editor)).toEqual({
			wire: '',
			offsets: {anchor: 0, focus: 0},
		});
	});

	it('inserts **** on Ctrl+B when composer is nonempty and selection is collapsed, placing caret in the middle', () => {
		const editor = createHarness();

		// At end of text
		setComposer(editor, 'hello', 5, 5);
		const handledEnd = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', ctrlKey: true}));
		expect(handledEnd).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello****',
			offsets: {anchor: 7, focus: 7},
		});

		// In middle of text
		setComposer(editor, 'hello world', 5, 5);
		const handledMiddle = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', ctrlKey: true}));
		expect(handledMiddle).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello**** world',
			offsets: {anchor: 7, focus: 7},
		});

		// At start of text
		setComposer(editor, 'hello', 0, 0);
		const handledStart = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', ctrlKey: true}));
		expect(handledStart).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: '****hello',
			offsets: {anchor: 2, focus: 2},
		});

		// With a single character
		setComposer(editor, 'a', 1, 1);
		const handledSingle = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', ctrlKey: true}));
		expect(handledSingle).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'a****',
			offsets: {anchor: 3, focus: 3},
		});
	});

	it('inserts ** on Ctrl+I when composer is nonempty and selection is collapsed, placing caret in the middle', () => {
		const editor = createHarness();

		// At end of text
		setComposer(editor, 'hello', 5, 5);
		const handledEnd = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'i', ctrlKey: true}));
		expect(handledEnd).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello**',
			offsets: {anchor: 6, focus: 6},
		});

		// In middle of text
		setComposer(editor, 'hello world', 5, 5);
		const handledMiddle = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'i', ctrlKey: true}));
		expect(handledMiddle).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello** world',
			offsets: {anchor: 6, focus: 6},
		});

		// At start of text
		setComposer(editor, 'hello', 0, 0);
		const handledStart = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'i', ctrlKey: true}));
		expect(handledStart).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: '**hello',
			offsets: {anchor: 1, focus: 1},
		});
	});

	it('inserts **** or ** when composer contains spaces only and selection is collapsed', () => {
		const editor = createHarness();

		// Single space, collapsed at end
		setComposer(editor, ' ', 1, 1);
		const handledB = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', ctrlKey: true}));
		expect(handledB).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: ' ****',
			offsets: {anchor: 3, focus: 3},
		});

		// Multiple spaces, collapsed in middle
		setComposer(editor, '   ', 2, 2);
		const handledI = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'i', ctrlKey: true}));
		expect(handledI).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: '  ** ',
			offsets: {anchor: 3, focus: 3},
		});
	});

	it('works with metaKey (Cmd+B / Cmd+I on macOS)', () => {
		const editor = createHarness();

		setComposer(editor, 'test', 4, 4);
		const handled = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', metaKey: true}));
		expect(handled).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'test****',
			offsets: {anchor: 6, focus: 6},
		});

		setComposer(editor, 'test', 4, 4);
		const handledI = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'i', metaKey: true}));
		expect(handledI).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'test**',
			offsets: {anchor: 5, focus: 5},
		});
	});

	it('wraps selected text when a range is selected', () => {
		const editor = createHarness();

		setComposer(editor, 'hello world', 6, 11);
		const handledB = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', ctrlKey: true}));
		expect(handledB).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello **world**',
			offsets: {anchor: 8, focus: 13},
		});

		setComposer(editor, 'hello world', 6, 11);
		const handledI = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'i', ctrlKey: true}));
		expect(handledI).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello *world*',
			offsets: {anchor: 7, focus: 12},
		});
	});

	it('unwraps empty markers when caret is positioned between them', () => {
		const editor = createHarness();

		// Caret inside **|**
		setComposer(editor, 'hello**** world', 7, 7);
		const handledB = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'b', ctrlKey: true}));
		expect(handledB).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello world',
			offsets: {anchor: 5, focus: 5},
		});

		// Caret inside *|*
		setComposer(editor, 'hello** world', 6, 6);
		const handledI = run(editor, KEY_DOWN_COMMAND, keyEvent({key: 'i', ctrlKey: true}));
		expect(handledI).toBe(true);
		expect(getComposerState(editor)).toEqual({
			wire: 'hello world',
			offsets: {anchor: 5, focus: 5},
		});
	});

	it('ignores keys with altKey or non-matching modifiers', () => {
		const editor = createHarness();
		setComposer(editor, 'hello', 5, 5);

		// Alt+Ctrl+B
		const altEvent = keyEvent({key: 'b', ctrlKey: true, altKey: true});
		run(editor, KEY_DOWN_COMMAND, altEvent);
		expect(altEvent.preventDefault).not.toHaveBeenCalled();

		// No ctrl/meta key
		const plainEvent = keyEvent({key: 'b'});
		run(editor, KEY_DOWN_COMMAND, plainEvent);
		expect(plainEvent.preventDefault).not.toHaveBeenCalled();

		// Shift+Ctrl+B (B requires shift: false)
		const shiftEvent = keyEvent({key: 'b', ctrlKey: true, shiftKey: true});
		run(editor, KEY_DOWN_COMMAND, shiftEvent);
		expect(shiftEvent.preventDefault).not.toHaveBeenCalled();

		expect(getComposerState(editor)).toEqual({
			wire: 'hello',
			offsets: {anchor: 5, focus: 5},
		});
	});
});
