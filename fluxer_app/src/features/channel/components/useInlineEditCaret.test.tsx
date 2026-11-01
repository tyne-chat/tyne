// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {
	insertMentionInInlineEdit,
	returnFocusToInlineEdit,
	useInlineEditCaret,
} from '@app/features/channel/components/useInlineEditCaret';
import type {LexicalRichInputHandle} from '@app/features/lexical/composer/LexicalRichInput';
import {act, useRef} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHANNEL_ID = 'channel-1';

function InlineEdit({composer, disabled = false}: {composer: LexicalRichInputHandle; disabled?: boolean}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<LexicalRichInputHandle | null>(composer);
	useInlineEditCaret({channelId: CHANNEL_ID, disabled, containerRef, composerRef});
	return (
		<div ref={containerRef} data-flx="channel.use-inline-edit-timestamp-insert-test.inline-edit.div">
			<div
				contentEditable={true}
				data-testid="edit"
				data-flx="channel.use-inline-edit-timestamp-insert-test.inline-edit.edit"
			/>
		</div>
	);
}

function moveFocusTo(element: Element): void {
	element.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
}

describe('useInlineEditCaret', () => {
	let host: HTMLDivElement;
	let root: Root;
	let channelComposer: HTMLDivElement;
	let composer: {[K in keyof LexicalRichInputHandle]: ReturnType<typeof vi.fn>};
	let frames: Array<FrameRequestCallback>;

	const runFrame = () => frames.shift()?.(0);

	const openEdit = (disabled = false) => {
		act(() =>
			root.render(
				<InlineEdit
					composer={composer as unknown as LexicalRichInputHandle}
					disabled={disabled}
					data-flx="channel.use-inline-edit-timestamp-insert-test.open-edit.inline-edit"
				/>,
			),
		);
	};

	beforeEach(() => {
		host = document.createElement('div');
		channelComposer = document.createElement('div');
		channelComposer.contentEditable = 'true';
		document.body.append(host, channelComposer);
		root = createRoot(host);
		composer = {
			focus: vi.fn(),
			insertEmoji: vi.fn(),
			insertTimestamp: vi.fn(),
			getEditor: vi.fn(),
			insertMention: vi.fn(),
		};
		frames = [];
		vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		channelComposer.remove();
		document.body.removeAttribute('inert');
		vi.restoreAllMocks();
	});

	describe('a mention from outside the box', () => {
		const mention = {id: 'user-1', display: '@Fox', wire: '<@user-1:persona-1>'};

		it('goes to the edit while it holds the caret, and focus comes back to it', () => {
			openEdit();

			expect(insertMentionInInlineEdit(CHANNEL_ID, mention)).toBe(true);
			runFrame();

			expect(composer.insertMention).toHaveBeenCalledWith(mention);
			expect(composer.focus).toHaveBeenCalledTimes(1);
		});

		it('is left to the composer once the composer has the caret', () => {
			openEdit();
			moveFocusTo(channelComposer);

			expect(insertMentionInInlineEdit(CHANNEL_ID, mention)).toBe(false);
			expect(composer.insertMention).not.toHaveBeenCalled();
		});

		it('is left to the composer while the edit is disabled', () => {
			openEdit(true);

			expect(insertMentionInInlineEdit(CHANNEL_ID, mention)).toBe(false);
			expect(composer.insertMention).not.toHaveBeenCalled();
		});

		it('is left to the composer with no edit open', () => {
			expect(insertMentionInInlineEdit(CHANNEL_ID, mention)).toBe(false);
		});
	});

	it('keeps the caret while focus passes through the plus menu and the modal', () => {
		openEdit();
		const button = document.createElement('button');
		const input = document.createElement('input');
		document.body.append(button, input);

		moveFocusTo(button);
		moveFocusTo(input);

		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(true);
		button.remove();
		input.remove();
	});

	it('holds the caret again when it comes back from the composer', () => {
		openEdit();

		moveFocusTo(channelComposer);
		moveFocusTo(host.querySelector('[data-testid="edit"]') as Element);

		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(true);
	});

	it('takes focus back on the next frame while it holds the caret', () => {
		openEdit();

		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(true);
		expect(composer.focus).not.toHaveBeenCalled();

		runFrame();

		expect(composer.focus).toHaveBeenCalledTimes(1);
	});

	it('leaves focus alone once the caret has moved to the composer', () => {
		openEdit();

		moveFocusTo(channelComposer);

		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(false);
		expect(frames).toHaveLength(0);
	});

	it('leaves focus alone when the caret moves away before the frame runs', () => {
		openEdit();

		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(true);
		moveFocusTo(channelComposer);
		runFrame();

		expect(composer.focus).not.toHaveBeenCalled();
	});

	it('leaves focus alone for another channel, when disabled and after the edit has closed', () => {
		openEdit(true);
		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(false);

		openEdit();
		expect(returnFocusToInlineEdit('channel-2')).toBe(false);

		act(() => root.render(null));
		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(false);

		expect(frames).toHaveLength(0);
	});

	it('takes focus back only once the modal has stopped making it inert', () => {
		openEdit();
		document.body.setAttribute('inert', '');

		expect(returnFocusToInlineEdit(CHANNEL_ID)).toBe(true);

		runFrame();
		runFrame();
		expect(composer.focus).not.toHaveBeenCalled();

		document.body.removeAttribute('inert');
		runFrame();
		expect(composer.focus).toHaveBeenCalledTimes(1);
		expect(frames).toHaveLength(0);
	});

	it('gives up on a modal that stays open, and the modal closing asks again', () => {
		openEdit();
		document.body.setAttribute('inert', '');

		returnFocusToInlineEdit(CHANNEL_ID);
		for (let frame = 0; frame < 40; frame++) {
			runFrame();
		}
		expect(frames).toHaveLength(0);
		expect(composer.focus).not.toHaveBeenCalled();

		document.body.removeAttribute('inert');
		returnFocusToInlineEdit(CHANNEL_ID);
		runFrame();
		expect(composer.focus).toHaveBeenCalledTimes(1);
	});
});
