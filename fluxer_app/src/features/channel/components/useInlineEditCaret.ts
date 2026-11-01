// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ComposerMentionInsert} from '@app/features/lexical/composer/ComposerInsertion';
import type {LexicalRichInputHandle} from '@app/features/lexical/composer/LexicalRichInput';
import type React from 'react';
import {useEffect} from 'react';

const MAX_INERT_FRAMES = 30;

const editsByChannelId = new Map<
	string,
	{returnFocus: () => boolean; insertMention: (mention: ComposerMentionInsert) => boolean}
>();

// A modal keeps the page behind it inert until it has gone, and an inert editor cannot take focus.
function focusOnceNotInert(element: HTMLElement, focus: () => void, frame = 0): void {
	if (!element.isConnected) {
		return;
	}
	if (element.closest('[inert]') == null) {
		focus();
	} else if (frame < MAX_INERT_FRAMES) {
		window.requestAnimationFrame(() => focusOnceNotInert(element, focus, frame + 1));
	}
}

// The focus waits a frame: the press that closes a menu can still take it away when it ends.
export function focusWhenPossible(element: HTMLElement | null | undefined, focus: () => void): void {
	if (element != null) {
		window.requestAnimationFrame(() => focusOnceNotInert(element, focus));
	}
}

// Going to the channel composer's plus menu takes focus out of the edit. Left there, what is typed
// next goes to the composer, where Enter sends it. False when no edit in the channel holds the caret.
export function returnFocusToInlineEdit(channelId: string): boolean {
	return editsByChannelId.get(channelId)?.returnFocus() ?? false;
}

// A mention starts from a name, not from a box, so it follows the caret. False when no edit in the
// channel holds it.
export function insertMentionInInlineEdit(channelId: string, mention: ComposerMentionInsert): boolean {
	return editsByChannelId.get(channelId)?.insertMention(mention) ?? false;
}

export function useInlineEditCaret({
	channelId,
	disabled,
	containerRef,
	composerRef,
}: {
	channelId: string;
	disabled: boolean;
	containerRef: React.RefObject<HTMLElement | null>;
	composerRef: React.RefObject<LexicalRichInputHandle | null>;
}): void {
	useEffect(() => {
		// The edit focuses itself when it opens. Reaching the plus menu moves focus to buttons and
		// the modal's fields, so only another editor takes the caret away.
		let holdsCaret = true;
		const handleFocusIn = (event: FocusEvent) => {
			const {target} = event;
			if (target instanceof HTMLElement && target.isContentEditable) {
				holdsCaret = containerRef.current?.contains(target) === true;
			}
		};
		const returnFocus = () => {
			const composer = composerRef.current;
			const container = containerRef.current;
			if (disabled || !holdsCaret || composer == null || container == null) {
				return false;
			}
			focusWhenPossible(container, () => {
				if (holdsCaret) {
					composer.focus();
				}
			});
			return true;
		};
		const insertMention = (mention: ComposerMentionInsert) => {
			if (disabled || !holdsCaret) {
				return false;
			}
			composerRef.current?.insertMention(mention);
			return returnFocus();
		};
		document.addEventListener('focusin', handleFocusIn);
		editsByChannelId.set(channelId, {returnFocus, insertMention});
		return () => {
			document.removeEventListener('focusin', handleFocusIn);
			editsByChannelId.delete(channelId);
		};
	}, [channelId, composerRef, containerRef, disabled]);
}
