// SPDX-License-Identifier: AGPL-3.0-or-later

import {resolvePastedLinkInsertion} from '@app/features/lexical/composer/ComposerLinkPaste';
import {replaceSelectedText} from '@app/features/messaging/utils/TextInputEditUtils';
import type React from 'react';

/**
 * A link pasted over selected text becomes a Markdown link, as it does in the composer and the
 * profile's About Me editor (`ComposerClipboard.ts`). Those are rich inputs; this is for a plain
 * textarea. Any other paste, or one the field's length limit has no room for, carries on as usual.
 */
export function pasteLinkOverSelection(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
	const input = event.currentTarget;
	const {selectionStart: start, selectionEnd: end, value, maxLength} = input;
	if (start === end) return;
	const replacement = resolvePastedLinkInsertion(event.clipboardData.getData('text/plain'), value.slice(start, end));
	if (replacement === null) return;
	if (maxLength >= 0 && value.length - (end - start) + replacement.length > maxLength) return;
	event.preventDefault();
	replaceSelectedText(input, replacement);
}
