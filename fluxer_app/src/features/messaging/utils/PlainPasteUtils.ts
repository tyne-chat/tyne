// SPDX-License-Identifier: AGPL-3.0-or-later

// Plain paste (Ctrl+Shift+V, Cmd+Shift+V, or "Paste as plain text" in the context menu) pastes the
// clipboard's text and nothing else: no files, not the composer's own clipboard format. Mentions and
// custom emoji in the text still become pills, as in Discord. Whether a paste is plain is decided once
// per paste event, so every handler that sees the event gives the same answer.
//
// A paste event does not say which keys started it, so the shortcut's keydown marks the next paste,
// and the capture listener below hands the mark to that event before any handler sees it. In Chromium
// the paste follows in the same task; on macOS the desktop app's menu delivers it later, hence the
// time limit.

const PLAIN_PASTE_SHORTCUT_WINDOW_MS = 500;

const plainPasteEvents = new WeakSet<Event>();
let plainPastePending = false;
let plainPasteTimeout: ReturnType<typeof setTimeout> | null = null;

export function markNextPasteAsPlain(): void {
	plainPastePending = true;
	if (plainPasteTimeout !== null) {
		clearTimeout(plainPasteTimeout);
	}
	plainPasteTimeout = setTimeout(clearPendingPlainPaste, PLAIN_PASTE_SHORTCUT_WINDOW_MS);
}

function clearPendingPlainPaste(): void {
	plainPastePending = false;
	if (plainPasteTimeout !== null) {
		clearTimeout(plainPasteTimeout);
		plainPasteTimeout = null;
	}
}

export function isPlainPasteEvent(event: Event): boolean {
	return plainPasteEvents.has(event);
}

// Pastes `text` into a contenteditable through its own paste handling, as a paste from a clipboard
// that holds only that text, so the composer applies its length check, upload offer and tab
// normalisation as for a keyboard paste. A synthetic paste inserts nothing by itself: when no handler
// takes it, the text is inserted as typed text instead.
export function pasteTextIntoContentEditable(target: HTMLElement, text: string, plain: boolean): boolean {
	if (dispatchTextPaste(target, text, plain)) {
		return true;
	}
	return document.execCommand('insertText', false, text);
}

function dispatchTextPaste(target: HTMLElement, text: string, plain: boolean): boolean {
	let event: ClipboardEvent;
	try {
		const clipboardData = new DataTransfer();
		clipboardData.setData('text/plain', text);
		event = new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData});
	} catch {
		return false;
	}
	// This paste is the menu's, not the one a recent shortcut was waiting for.
	clearPendingPlainPaste();
	if (plain) {
		plainPasteEvents.add(event);
	}
	return !target.dispatchEvent(event);
}

function isPasteShortcut(event: KeyboardEvent): boolean {
	return (event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V' || event.code === 'KeyV');
}

if (typeof window !== 'undefined') {
	window.addEventListener(
		'keydown',
		(event) => {
			if (!isPasteShortcut(event)) {
				return;
			}
			if (event.shiftKey) {
				markNextPasteAsPlain();
			} else {
				clearPendingPlainPaste();
			}
		},
		true,
	);
	window.addEventListener(
		'paste',
		(event) => {
			if (!plainPastePending) {
				return;
			}
			clearPendingPlainPaste();
			plainPasteEvents.add(event);
		},
		true,
	);
}
