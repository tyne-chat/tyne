// SPDX-License-Identifier: AGPL-3.0-or-later

import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CopyIcon, PencilSimpleIcon, TrashIcon} from '@phosphor-icons/react';

export const EDIT_TIMESTAMP_DESCRIPTOR = msg({
	message: 'Edit timestamp',
	comment: 'Context menu action to edit a timestamp in the message composer.',
});

export const COPY_TIMESTAMP_DESCRIPTOR = msg({
	message: 'Copy timestamp',
	comment: 'Context menu action to copy a timestamp markdown tag in the message composer.',
});

export const DELETE_TIMESTAMP_DESCRIPTOR = msg({
	message: 'Delete timestamp',
	comment: 'Context menu action to delete a timestamp from the message composer.',
});

export interface ComposerTimestampContextMenuProps {
	onClose: () => void;
	wire: string;
	onEdit: () => void;
	onDelete: () => void;
}

export function ComposerTimestampContextMenu({onClose, wire, onEdit, onDelete}: ComposerTimestampContextMenuProps) {
	const {i18n} = useLingui();

	const handleCopy = () => {
		void navigator.clipboard?.writeText(wire);
		onClose();
	};

	return (
		<MenuGroup data-flx="lexical.composer.timestamp-context-menu.menu-group">
			<MenuItem
				icon={
					<PencilSimpleIcon
						size={16}
						data-flx="lexical.composer.nodes.composer-timestamp-context-menu.pencil-simple-icon"
					/>
				}
				onClick={() => {
					onClose();
					onEdit();
				}}
				data-flx="lexical.composer.timestamp-context-menu.edit"
			>
				{i18n._(EDIT_TIMESTAMP_DESCRIPTOR)}
			</MenuItem>
			<MenuItem
				icon={<CopyIcon size={16} data-flx="lexical.composer.nodes.composer-timestamp-context-menu.copy-icon" />}
				onClick={handleCopy}
				data-flx="lexical.composer.timestamp-context-menu.copy"
			>
				{i18n._(COPY_TIMESTAMP_DESCRIPTOR)}
			</MenuItem>
			<MenuItem
				icon={<TrashIcon size={16} data-flx="lexical.composer.nodes.composer-timestamp-context-menu.trash-icon" />}
				danger
				onClick={() => {
					onClose();
					onDelete();
				}}
				data-flx="lexical.composer.timestamp-context-menu.delete"
			>
				{i18n._(DELETE_TIMESTAMP_DESCRIPTOR)}
			</MenuItem>
		</MenuGroup>
	);
}
