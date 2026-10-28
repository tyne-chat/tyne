// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {isPlainPasteEvent, markNextPasteAsPlain, pasteTextIntoContentEditable} from './PlainPasteUtils';

function pressPaste(shift: boolean): void {
	window.dispatchEvent(new KeyboardEvent('keydown', {key: shift ? 'V' : 'v', ctrlKey: true, shiftKey: shift}));
}

// Fires a paste the way the browser does after the shortcut, and records what each of two handlers
// (the composer's and the upload manager's, say) was told about it.
function firePaste(target: EventTarget = document.body): {event: Event; seen: Array<boolean>} {
	const seen: Array<boolean> = [];
	const record = (event: Event) => seen.push(isPlainPasteEvent(event));
	target.addEventListener('paste', record);
	window.addEventListener('paste', record);
	const event = new Event('paste', {bubbles: true, cancelable: true});
	target.dispatchEvent(event);
	target.removeEventListener('paste', record);
	window.removeEventListener('paste', record);
	return {event, seen};
}

describe('PlainPasteUtils', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Leaves no mark from the previous test: a Ctrl+V clears it.
		pressPaste(false);
	});

	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = '';
	});

	it('treats a paste without the shortcut as a normal paste', () => {
		expect(firePaste().seen).toEqual([false, false]);
	});

	it('marks the paste after Ctrl+Shift+V as plain for every handler that sees it', () => {
		pressPaste(true);
		const {event, seen} = firePaste();
		expect(seen).toEqual([true, true]);
		expect(isPlainPasteEvent(event)).toBe(true);
	});

	it('marks only the one paste the shortcut started', () => {
		pressPaste(true);
		firePaste();
		expect(firePaste().seen).toEqual([false, false]);
	});

	it('marks the paste after Cmd+Shift+V too', () => {
		window.dispatchEvent(new KeyboardEvent('keydown', {key: 'v', code: 'KeyV', metaKey: true, shiftKey: true}));
		expect(firePaste().seen).toEqual([true, true]);
	});

	it('drops the mark when Ctrl+V follows', () => {
		pressPaste(true);
		pressPaste(false);
		expect(firePaste().seen).toEqual([false, false]);
	});

	it('drops the mark when no paste follows within 500 ms', () => {
		pressPaste(true);
		vi.advanceTimersByTime(499);
		markNextPasteAsPlain();
		vi.advanceTimersByTime(499);
		expect(firePaste().seen).toEqual([true, true]);
		pressPaste(true);
		vi.advanceTimersByTime(500);
		expect(firePaste().seen).toEqual([false, false]);
	});

	describe('pasteTextIntoContentEditable', () => {
		function editable(): HTMLElement {
			const element = document.createElement('div');
			element.contentEditable = 'true';
			document.body.append(element);
			return element;
		}

		function stubExecCommand() {
			const execCommand = vi.fn(() => true);
			Object.defineProperty(document, 'execCommand', {configurable: true, value: execCommand});
			return execCommand;
		}

		it('hands the text to the target as a paste of text only, marked plain', () => {
			const target = editable();
			const execCommand = stubExecCommand();
			const pastes: Array<{plain: boolean; types: Array<string>; text: string | undefined}> = [];
			target.addEventListener('paste', (event) => {
				const clipboardData = (event as ClipboardEvent).clipboardData;
				pastes.push({
					plain: isPlainPasteEvent(event),
					types: [...(clipboardData?.types ?? [])],
					text: clipboardData?.getData('text/plain'),
				});
				event.preventDefault();
			});
			expect(pasteTextIntoContentEditable(target, 'a\tb <@1>', true)).toBe(true);
			expect(pastes).toEqual([{plain: true, types: ['text/plain'], text: 'a\tb <@1>'}]);
			expect(execCommand).not.toHaveBeenCalled();
		});

		it('marks the paste as normal when asked for a normal paste', () => {
			const target = editable();
			stubExecCommand();
			const plain: Array<boolean> = [];
			target.addEventListener('paste', (event) => {
				plain.push(isPlainPasteEvent(event));
				event.preventDefault();
			});
			pasteTextIntoContentEditable(target, 'text', false);
			expect(plain).toEqual([false]);
		});

		it('inserts the text itself when no handler takes the paste', () => {
			const target = editable();
			const execCommand = stubExecCommand();
			expect(pasteTextIntoContentEditable(target, 'text', true)).toBe(true);
			expect(execCommand).toHaveBeenCalledWith('insertText', false, 'text');
		});

		it('leaves a pending shortcut mark off its own paste and off the next one', () => {
			const target = editable();
			stubExecCommand();
			const plain: Array<boolean> = [];
			target.addEventListener('paste', (event) => {
				plain.push(isPlainPasteEvent(event));
				event.preventDefault();
			});
			pressPaste(true);
			pasteTextIntoContentEditable(target, 'text', false);
			expect(plain).toEqual([false]);
			expect(firePaste().seen).toEqual([false, false]);
		});
	});
});
