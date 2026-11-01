// SPDX-License-Identifier: AGPL-3.0-or-later

import Accessibility from '@app/features/accessibility/state/Accessibility';
import {canDeleteAttachmentUtil} from '@app/features/channel/components/MessageActionUtils';
import {DELETE_ATTACHMENT_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {useDeleteAttachment} from '@app/features/messaging/hooks/useDeleteAttachment';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {DeleteIcon} from '@app/features/ui/action_menu/ContextMenuIcons';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import type {MenuActionEvent, MenuGroupType} from '@app/features/ui/menu_bottom_sheet/MenuBottomSheet';
import type {I18n} from '@lingui/core';
import {useLingui} from '@lingui/react/macro';
import type React from 'react';
import {useMemo} from 'react';

const ATTACHMENT_ID_ATTRIBUTE = 'data-attachment-id';

// A marker for the attachment a long press landed on, for those that have no long press of their own.
export function attachmentMarker(attachmentId: string): Record<string, string> {
	return {[ATTACHMENT_ID_ATTRIBUTE]: attachmentId};
}

export function pressedAttachmentId(target: Element | null): string | undefined {
	return target?.closest(`[${ATTACHMENT_ID_ATTRIBUTE}]`)?.getAttribute(ATTACHMENT_ID_ATTRIBUTE) ?? undefined;
}

export function deleteAttachmentMenuGroup(
	i18n: I18n,
	onClose: () => void,
	requestDelete: (event: React.MouseEvent) => void,
): MenuGroupType {
	return {
		items: [
			{
				id: 'attachment_delete',
				icon: <DeleteIcon size={20} data-flx="channel.delete-attachment-menu-group.delete-icon" />,
				label: i18n._(DELETE_ATTACHMENT_DESCRIPTOR),
				danger: true,
				onClick: (event?: MenuActionEvent) => {
					ModalCommands.runAfterBottomSheetClose(onClose, () => requestDelete(event as React.MouseEvent));
				},
			},
		],
	};
}

// Touch has no hover, so the trash buttons on attachments never show on the mobile layout: its
// long-press sheets offer this instead (tyne-chat/tyne#294). The same conditions as those buttons.
export function useDeleteAttachmentMenuGroups(
	message: Message | null | undefined,
	attachmentId: string | undefined,
	onClose: () => void,
	onDeleted?: () => void,
): Array<MenuGroupType> {
	const {i18n} = useLingui();
	const requestDelete = useDeleteAttachment(message, attachmentId, {onDeleted});
	const canDelete =
		Accessibility.showMediaDeleteButton &&
		attachmentId !== undefined &&
		canDeleteAttachmentUtil(message ?? undefined) &&
		message?.attachments.some((attachment) => attachment.id === attachmentId) === true;
	return useMemo(
		() => (canDelete ? [deleteAttachmentMenuGroup(i18n, onClose, requestDelete)] : []),
		[canDelete, i18n, i18n.locale, onClose, requestDelete],
	);
}
