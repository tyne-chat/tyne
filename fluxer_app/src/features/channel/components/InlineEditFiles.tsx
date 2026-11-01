// SPDX-License-Identifier: AGPL-3.0-or-later

import {Limits} from '@app/features/app/utils/UserLimits';
import type {Channel} from '@app/features/channel/models/Channel';
import type {LexicalRichInputHandle} from '@app/features/lexical/composer/LexicalRichInput';
import {showAttachmentPermissionDeniedModal} from '@app/features/messaging/components/alerts/AttachmentPermissionDeniedModal';
import {FileSizeTooLargeModal} from '@app/features/messaging/components/alerts/FileSizeTooLargeModal';
import {TooManyAttachmentsModal} from '@app/features/messaging/components/alerts/TooManyAttachmentsModal';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import InlineEditUploads from '@app/features/messaging/state/InlineEditUploads';
import {CloudUpload} from '@app/features/messaging/upload/CloudUpload';
import {canAttachFilesInChannel} from '@app/features/messaging/utils/AttachmentPermissionUtils';
import {getClipboardDataFiles, readClipboardImageFiles} from '@app/features/messaging/utils/ClipboardFilePasteUtils';
import * as FileUploadUtils from '@app/features/messaging/utils/FileUploadUtils';
import {isPlainPasteEvent} from '@app/features/messaging/utils/PlainPasteUtils';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {COMMAND_PRIORITY_HIGH, PASTE_COMMAND} from 'lexical';
import type React from 'react';
import {useEffect} from 'react';

export async function addFilesToInlineEdit(channel: Channel, message: Message, files: Array<File>): Promise<void> {
	if (!canAttachFilesInChannel(channel)) {
		showAttachmentPermissionDeniedModal(channel);
		return;
	}
	const key = InlineEditUploads.attachmentKey(message.id);
	const adding = FileUploadUtils.handleFileUpload(
		channel.id,
		files,
		message.attachments.length + CloudUpload.getTextareaAttachments(key).length,
		Limits.getMaxAttachmentsPerMessage(),
		key,
	);
	InlineEditUploads.trackAdding(message.id, adding);
	const result = await adding;
	if (result.success) {
		return;
	}
	if (result.error === 'too_many_attachments') {
		ModalCommands.push(
			ModalCommands.modal(() => (
				<TooManyAttachmentsModal data-flx="channel.inline-edit-files.too-many-attachments-modal" />
			)),
		);
	} else if (result.error === 'file_size_too_large') {
		ModalCommands.push(
			ModalCommands.modal(() => (
				<FileSizeTooLargeModal
					oversizedFileCount={result.oversizedFileCount}
					data-flx="channel.inline-edit-files.file-size-too-large-modal"
				/>
			)),
		);
	}
}

// The composer's paste handling is registered on its own editor, so a file pasted here needs this.
// The same rules as useChannelComposerPaste: files win over text, plain paste never takes a file,
// and a clipboard holding an image but no files or text is read through the async clipboard API.
export function useInlineEditFilePaste({
	channel,
	message,
	disabled,
	composerRef,
}: {
	channel: Channel;
	message: Message;
	disabled: boolean;
	composerRef: React.RefObject<LexicalRichInputHandle | null>;
}): void {
	useEffect(() => {
		const editor = composerRef.current?.getEditor();
		if (editor == null || disabled) {
			return undefined;
		}
		return editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (typeof ClipboardEvent === 'undefined' || !(event instanceof ClipboardEvent)) {
					return false;
				}
				const {clipboardData} = event;
				if (clipboardData === null || isPlainPasteEvent(event)) {
					return false;
				}
				const files = getClipboardDataFiles(clipboardData);
				if (files.length > 0) {
					event.preventDefault();
					void addFilesToInlineEdit(channel, message, files);
					return true;
				}
				if (!clipboardData.getData('text/plain')) {
					InlineEditUploads.trackAdding(
						message.id,
						readClipboardImageFiles().then((clipboardFiles) =>
							clipboardFiles.length > 0 ? addFilesToInlineEdit(channel, message, clipboardFiles) : undefined,
						),
					);
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH,
		);
	}, [channel, composerRef, disabled, message]);
}
