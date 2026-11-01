// SPDX-License-Identifier: AGPL-3.0-or-later

import Accessibility from '@app/features/accessibility/state/Accessibility';
import {OPEN_MENU_DESCRIPTOR} from '@app/features/channel/components/channel_textarea/shared';
import styles from '@app/features/channel/components/EditingMessageInput.module.css';
import {addFilesToInlineEdit} from '@app/features/channel/components/InlineEditFiles';
import {openTimestampModal} from '@app/features/channel/components/modals/TimestampModal';
import {TextareaButton} from '@app/features/channel/components/textarea/TextareaButton';
import {focusWhenPossible} from '@app/features/channel/components/useInlineEditCaret';
import type {Channel} from '@app/features/channel/models/Channel';
import {CHANGE_PERSONA_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import type {LexicalRichInputHandle} from '@app/features/lexical/composer/LexicalRichInput';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import InlineEditUploads from '@app/features/messaging/state/InlineEditUploads';
import MessageChangePersona from '@app/features/messaging/state/MessageChangePersona';
import {canAttachFilesInChannel} from '@app/features/messaging/utils/AttachmentPermissionUtils';
import {openFilePicker} from '@app/features/messaging/utils/FilePickerUtils';
import {canSubmitEmptyMessageEdit} from '@app/features/messaging/utils/MessageEditContentUtils';
import {formatUploadingAttachmentSummary} from '@app/features/messaging/utils/UploadingAttachmentLabelUtils';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {PersonaPickerSheet} from '@app/features/persona/components/PersonaPickerSheet';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {openPopout} from '@app/features/ui/popover/PopoverPopout';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import Users from '@app/features/user/state/Users';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {ClockIcon, PaperclipIcon, PlusIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

const UPLOAD_FILE_DESCRIPTOR = msg({
	message: 'Upload file',
	comment: 'Plus menu item that opens the system file picker to attach a file.',
});

const INSERT_TIMESTAMP_DESCRIPTOR = msg({
	message: 'Insert timestamp',
	comment: 'Plus menu item that opens the dynamic timestamp insertion modal.',
});

const PLUS_ICON_PROPS = {weight: 'bold'} as const;

export const InlineEditControls = observer(
	({
		channel,
		message,
		text,
		disabled,
		containerRef,
		composerRef,
		editableRef,
	}: {
		channel: Channel;
		message: Message;
		text: string;
		disabled: boolean;
		containerRef: React.RefObject<HTMLElement | null>;
		composerRef: React.RefObject<LexicalRichInputHandle | null>;
		editableRef: React.RefObject<HTMLElement | null>;
	}) => {
		const {i18n} = useLingui();
		const plusButtonRef = useRef<HTMLButtonElement | null>(null);
		const personaButtonRef = useRef<HTMLButtonElement | null>(null);
		const [pickerOpen, setPickerOpen] = useState(false);
		const currentUser = Users.getCurrentUser();
		const uploadingCount = InlineEditUploads.uploadingCount(message.id);
		const showPersona = Accessibility.showPersonasButton && PersonaStore.personas.length > 0;
		const typedSubprofile = PersonaStore.matchEditMessage(text, message.subprofile, {
			hasAttachments: canSubmitEmptyMessageEdit(message),
			originalContent: message.content,
		}).subprofile;
		const resolvedSubprofile = MessageChangePersona.resolveEditSubprofile(message.id, typedSubprofile);
		const shownSubprofile = resolvedSubprofile === undefined ? (message.subprofile ?? null) : resolvedSubprofile;

		useEffect(() => {
			InlineEditUploads.trackEdit(message.channelId, message.id);
		}, [message.channelId, message.id]);

		const returnCaret = useCallback(() => {
			focusWhenPossible(containerRef.current, () => composerRef.current?.focus());
		}, [composerRef, containerRef]);

		const handleInsertTimestamp = useCallback(() => {
			ContextMenuCommands.close();
			openTimestampModal({
				onInsert: (_markdown, meta) => {
					if (meta) {
						composerRef.current?.insertTimestamp(meta.epoch, meta.format);
					}
				},
				onClosed: returnCaret,
			});
		}, [composerRef, returnCaret]);

		const handleUploadFile = useCallback(async () => {
			ContextMenuCommands.close();
			const files = await openFilePicker({multiple: true});
			returnCaret();
			if (files.length > 0) {
				await addFilesToInlineEdit(channel, message, files);
			}
		}, [channel, message, returnCaret]);

		const handlePlusClick = useCallback(() => {
			const button = plusButtonRef.current;
			if (button == null || disabled) {
				return;
			}
			const rect = button.getBoundingClientRect();
			ContextMenuCommands.openForElement(
				button,
				() => (
					<MenuGroup data-flx="channel.inline-edit-controls.menu-group">
						<MenuItem
							icon={<PaperclipIcon weight="bold" data-flx="channel.inline-edit-controls.paperclip-icon" />}
							onClick={handleUploadFile}
							disabled={!canAttachFilesInChannel(channel)}
							data-flx="channel.inline-edit-controls.menu-item.upload-file"
						>
							{i18n._(UPLOAD_FILE_DESCRIPTOR)}
						</MenuItem>
						<MenuItem
							icon={<ClockIcon weight="bold" data-flx="channel.inline-edit-controls.clock-icon" />}
							onClick={handleInsertTimestamp}
							data-flx="channel.inline-edit-controls.menu-item.insert-timestamp"
						>
							{i18n._(INSERT_TIMESTAMP_DESCRIPTOR)}
						</MenuItem>
					</MenuGroup>
				),
				{
					point: {x: rect.left + window.scrollX, y: rect.top + window.scrollY},
					config: {align: 'bottom-left', onClose: returnCaret},
				},
			);
		}, [channel, disabled, handleInsertTimestamp, handleUploadFile, i18n, returnCaret]);

		const handlePersonaClick = useCallback(() => {
			const button = personaButtonRef.current;
			if (button == null || disabled) {
				return;
			}
			const popoutKey = `editing-persona-picker-${message.id}`;
			if (pickerOpen) {
				PopoutCommands.close(popoutKey);
				return;
			}
			openPopout(
				button,
				{
					render: ({onClose}) => (
						<PersonaPickerSheet
							onClose={onClose}
							showModes={false}
							selectedPersonaId={shownSubprofile?.id ?? ''}
							onSelectPersona={(id) => {
								const persona = PersonaStore.personas.find((candidate) => candidate.id === id);
								if (persona != null) {
									MessageChangePersona.setPendingSubprofile(
										message.id,
										MessageChangePersona.buildSubprofilePayload(persona),
									);
								}
							}}
							onSelectAccount={() => MessageChangePersona.setPendingSubprofile(message.id, null)}
							data-flx="channel.inline-edit-controls.persona-picker-sheet"
						/>
					),
					position: 'top-start',
					animationType: 'none',
					onOpen: () => setPickerOpen(true),
					onClose: () => {
						setPickerOpen(false);
						returnCaret();
					},
					returnFocusRef: editableRef,
				},
				popoutKey,
			);
		}, [disabled, editableRef, message.id, pickerOpen, returnCaret, shownSubprofile?.id]);

		return (
			<div className={styles.controls} data-flx="channel.inline-edit-controls">
				<TextareaButton
					ref={plusButtonRef}
					icon={PlusIcon}
					iconProps={PLUS_ICON_PROPS}
					label={i18n._(OPEN_MENU_DESCRIPTOR)}
					compact={true}
					disabled={disabled}
					onClick={handlePlusClick}
					data-flx="channel.inline-edit-controls.textarea-button.plus"
				/>
				{showPersona && currentUser != null && (
					<Tooltip text={shownSubprofile?.name ?? currentUser.username} data-flx="channel.inline-edit-controls.tooltip">
						<FocusRing offset={-2} data-flx="channel.inline-edit-controls.focus-ring">
							<button
								ref={personaButtonRef}
								type="button"
								className={styles.personaButton}
								aria-label={i18n._(CHANGE_PERSONA_DESCRIPTOR)}
								disabled={disabled}
								onClick={handlePersonaClick}
								data-flx="channel.inline-edit-controls.button.persona"
							>
								<PersonaAvatar
									user={currentUser}
									persona={shownSubprofile != null ? PersonaStore.getKnownPersona(shownSubprofile.id) : null}
									size={24}
									data-flx="channel.inline-edit-controls.persona-avatar"
								/>
							</button>
						</FocusRing>
					</Tooltip>
				)}
				{uploadingCount > 0 && (
					<span className={styles.uploading} data-flx="channel.inline-edit-controls.uploading">
						{formatUploadingAttachmentSummary(i18n, uploadingCount)}
					</span>
				)}
			</div>
		);
	},
);
