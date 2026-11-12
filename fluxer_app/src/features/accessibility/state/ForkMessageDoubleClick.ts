// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream's "Double-click a message to edit or reply" (`messageDoubleClickActions`) is one
// switch for two actions: double-clicking your own message opens it for editing, and
// double-clicking anyone else's starts a reply, which also takes double-click away from selecting a
// word there. The fork lets each be turned on by itself (tyne-chat/tyne#611): the switches write
// `messageDoubleClickEdits` and `messageDoubleClickReplies`, and keep upstream's setting on while
// either is on, so upstream's handler keeps its own check and asks here only which action may go on.
// A record without the fork's two (saved before they existed, or by an older client) reads as edit
// only, so an account with upstream's switch on keeps editing and stops replying.

import * as AccessibilityCommands from '@app/features/accessibility/commands/AccessibilityCommands';
import Accessibility from '@app/features/accessibility/state/Accessibility';

export interface MessageDoubleClickActions {
	edit: boolean;
	reply: boolean;
}

export function getMessageDoubleClickActions(): MessageDoubleClickActions {
	const enabled = Accessibility.messageDoubleClickActions;
	return {
		edit: enabled && Accessibility.messageDoubleClickEdits,
		reply: enabled && Accessibility.messageDoubleClickReplies,
	};
}

/** `edits`: whether upstream's handler is about to edit the message rather than reply to it. */
export function allowsMessageDoubleClick(edits: boolean): boolean {
	const actions = getMessageDoubleClickActions();
	return edits ? actions.edit : actions.reply;
}

export function setMessageDoubleClickActions(actions: MessageDoubleClickActions): void {
	AccessibilityCommands.update({
		messageDoubleClickActions: actions.edit || actions.reply,
		messageDoubleClickEdits: actions.edit,
		messageDoubleClickReplies: actions.reply,
	});
}
