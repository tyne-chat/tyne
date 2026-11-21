// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Message} from '@app/features/messaging/models/MessagingMessage';
import type {I18n} from '@lingui/core';
import type React from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockRemove, mockPush, mockRunAfterBottomSheetClose} = vi.hoisted(() => ({
	mockRemove: vi.fn(),
	mockPush: vi.fn(),
	mockRunAfterBottomSheetClose: vi.fn(),
}));

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));
vi.mock('@app/features/i18n/utils/CommonMessageDescriptors', () => ({
	REMOVE_BOOKMARK_DESCRIPTOR: {message: 'Remove bookmark'},
}));
vi.mock('@app/features/messaging/commands/SavedMessageCommands', () => ({remove: mockRemove}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: mockPush,
	modal: (render: () => React.ReactElement) => render,
	runAfterBottomSheetClose: mockRunAfterBottomSheetClose,
}));
vi.mock('@app/features/app/components/dialogs/ConfirmModal', () => ({ConfirmModal: () => null}));

const {requestRemoveBookmark, requestRemoveBookmarkFromMessage} = await import(
	'@app/features/messaging/commands/ForkBookmarkRemoval'
);

interface ConfirmProps {
	title: string;
	description: string;
	message?: Message;
	primaryText: string;
	onPrimary: () => void;
	showShiftBypassConfirmationTip: boolean;
}

const i18n = {
	_: (descriptor: {message?: string; id?: string}) => descriptor.message ?? descriptor.id,
} as unknown as I18n;
const message = {id: '1569810913161117696', channelId: '1549247151249293312'} as unknown as Message;

function pushedConfirmation(): ConfirmProps {
	expect(mockPush).toHaveBeenCalledTimes(1);
	const render = mockPush.mock.calls[0][0] as () => React.ReactElement<ConfirmProps>;
	return render().props;
}

beforeEach(() => {
	mockRemove.mockReset();
	mockPush.mockReset();
	mockRunAfterBottomSheetClose.mockReset();
});

describe('requestRemoveBookmark (the bookmarks list, like the pins list)', () => {
	it('asks first, and removes only when the confirmation is accepted', () => {
		requestRemoveBookmark(i18n, message.id, {message});

		expect(mockRemove).not.toHaveBeenCalled();
		const confirmation = pushedConfirmation();
		expect(confirmation).toMatchObject({
			title: 'Remove bookmark',
			description: 'Remove this bookmark?',
			primaryText: 'Remove bookmark',
			message,
			showShiftBypassConfirmationTip: false,
		});

		confirmation.onPrimary();
		expect(mockRemove).toHaveBeenCalledTimes(1);
		expect(mockRemove).toHaveBeenCalledWith(i18n, message.id);
	});

	it('removes at once with Shift held, without asking', () => {
		requestRemoveBookmark(i18n, message.id, {message, shiftKey: true});

		expect(mockPush).not.toHaveBeenCalled();
		expect(mockRemove).toHaveBeenCalledTimes(1);
		expect(mockRemove).toHaveBeenCalledWith(i18n, message.id);
	});

	it('asks without a preview for a bookmark whose message cannot be shown', () => {
		requestRemoveBookmark(i18n, message.id);

		expect(pushedConfirmation().message).toBeUndefined();
		expect(mockRemove).not.toHaveBeenCalled();
	});
});

describe('requestRemoveBookmarkFromMessage (the message menu and shortcut, like "Unpin")', () => {
	it('opens the confirmation, with the Shift tip, only once the menu has closed', () => {
		const onClose = vi.fn();
		requestRemoveBookmarkFromMessage(i18n, message, {onClose});

		expect(mockRunAfterBottomSheetClose).toHaveBeenCalledTimes(1);
		expect(mockRunAfterBottomSheetClose.mock.calls[0][0]).toBe(onClose);
		expect(mockPush).not.toHaveBeenCalled();

		const afterClose = mockRunAfterBottomSheetClose.mock.calls[0][1] as () => void;
		afterClose();
		const confirmation = pushedConfirmation();
		expect(confirmation.message).toBe(message);
		expect(confirmation.showShiftBypassConfirmationTip).toBe(true);
		expect(mockRemove).not.toHaveBeenCalled();

		confirmation.onPrimary();
		expect(mockRemove).toHaveBeenCalledWith(i18n, message.id);
	});

	it('removes once the menu has closed when Shift was held', () => {
		requestRemoveBookmarkFromMessage(i18n, message, {shiftKey: true, onClose: vi.fn()});

		expect(mockRemove).not.toHaveBeenCalled();
		(mockRunAfterBottomSheetClose.mock.calls[0][1] as () => void)();
		expect(mockPush).not.toHaveBeenCalled();
		expect(mockRemove).toHaveBeenCalledTimes(1);
	});

	it('asks at once from the shortcut, which has no menu to close', () => {
		requestRemoveBookmarkFromMessage(i18n, message);

		expect(mockRunAfterBottomSheetClose).not.toHaveBeenCalled();
		expect(pushedConfirmation().showShiftBypassConfirmationTip).toBe(true);
		expect(mockRemove).not.toHaveBeenCalled();
	});
});
