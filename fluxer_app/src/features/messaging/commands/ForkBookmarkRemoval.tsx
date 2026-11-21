// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: removing a bookmark asks first, the way unpinning a message does (tyne-chat/tyne#742). Upstream
// removes it on the first click of the bookmarks list's ×, where a click meant to close the panel took
// two bookmarks at once. Shift skips the question, as it does for pins. The list's × follows the pins
// list's ×, the message menu and the shortcut follow "Unpin" there (with the Shift tip, and after the
// phone layout's bottom sheet has closed).

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {REMOVE_BOOKMARK_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import * as SavedMessageCommands from '@app/features/messaging/commands/SavedMessageCommands';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';

const REMOVE_THIS_BOOKMARK_DESCRIPTOR = msg({
	message: 'Remove this bookmark?',
	comment:
		'Body of the confirmation shown before a bookmark (a saved message) is removed. Its title and button read "Remove bookmark".',
});

interface RemoveBookmarkOptions {
	// The bookmarked message, shown in the confirmation; absent for a bookmark whose message cannot be shown.
	message?: Message;
	shiftKey?: boolean;
	showShiftTip?: boolean;
}

export function requestRemoveBookmark(
	i18n: I18n,
	messageId: string,
	{message, shiftKey = false, showShiftTip = false}: RemoveBookmarkOptions = {},
): void {
	if (shiftKey) {
		SavedMessageCommands.remove(i18n, messageId);
		return;
	}
	ModalCommands.push(
		modal(() => (
			<ConfirmModal
				title={i18n._(REMOVE_BOOKMARK_DESCRIPTOR)}
				description={i18n._(REMOVE_THIS_BOOKMARK_DESCRIPTOR)}
				message={message}
				primaryText={i18n._(REMOVE_BOOKMARK_DESCRIPTOR)}
				onPrimary={() => SavedMessageCommands.remove(i18n, messageId)}
				showShiftBypassConfirmationTip={showShiftTip}
				data-flx="messaging.fork-bookmark-removal.confirm-modal"
			/>
		)),
	);
}

// From a message's menu or the bookmark shortcut, as "Unpin" there (`handlePinMessage`,
// `requestMessagePin`): with the Shift tip, and once the menu has closed, since a bottom sheet's
// closing pops a history entry that would take a confirmation opened before it along.
export function requestRemoveBookmarkFromMessage(
	i18n: I18n,
	message: Message,
	{shiftKey = false, onClose}: {shiftKey?: boolean; onClose?: () => void} = {},
): void {
	const removeBookmark = () => requestRemoveBookmark(i18n, message.id, {message, shiftKey, showShiftTip: true});
	if (onClose) {
		ModalCommands.runAfterBottomSheetClose(onClose, removeBookmark);
		return;
	}
	removeBookmark();
}
