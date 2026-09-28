// SPDX-License-Identifier: AGPL-3.0-or-later

import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';

// Fork imports.

import {EmojiPickerReactionContext} from '@app/features/channel/components/EmojiPicker';
import * as EmojiPickerCommands from '@app/features/emoji/commands/EmojiPickerCommands';
import EmojiPicker from '@app/features/emoji/state/EmojiPicker';
import ExpressionPicker from '@app/features/emoji/state/ExpressionPicker';
import Guilds from '@app/features/guild/state/Guilds';
import {LINK_COPIED_TO_CLIPBOARD_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {createDownloadHandler} from '@app/features/messaging/utils/FileDownloadUtils';
import {PersonaReactAsModal, REACT_AS_DESCRIPTOR} from '@app/features/persona/components/PersonaReactAsModal';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {
	CopyLinkIcon,
	CopyMediaIcon,
	DownloadMediaIcon,
	OpenMediaLinkIcon,
} from '@app/features/ui/action_menu/ContextMenuIcons';
import {CloneEmojiMenuItem} from '@app/features/ui/action_menu/items/CloneEmojiMenuItem';
import {copyMediaToClipboard} from '@app/features/ui/action_menu/items/MediaMenuData';
import styles from '@app/features/ui/action_menu/items/MenuItems.module.css';
import {ReverseImageSearchMenuItems} from '@app/features/ui/action_menu/items/ReverseImageSearchMenuItems';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {MenuItemSubmenu} from '@app/features/ui/action_menu/MenuItemSubmenu';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as TextCopyCommands from '@app/features/ui/commands/TextCopyCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {openExternalUrl} from '@app/features/ui/utils/NativeUtils';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {ClipboardIcon, Smiley, StarIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useCallback, useContext} from 'react';

const UNFAVORITE_EMOJI_DESCRIPTOR = msg({
	message: 'Unfavorite emoji',
	comment: 'Emoji context menu action that removes the emoji from favorites.',
});
const FAVORITE_EMOJI_DESCRIPTOR = msg({
	message: 'Favorite emoji',
	comment: 'Emoji context menu action that adds the emoji to favorites.',
});
const COPY_EMOJI_ID_DESCRIPTOR = msg({
	message: 'Copy emoji ID',
	comment: 'Developer-mode action that copies the emoji ID to the clipboard.',
});
const COPY_IMAGE_DESCRIPTOR = msg({
	message: 'Copy image',
	comment: 'Media context menu action that copies an image to the clipboard.',
});
const COPY_GIF_DESCRIPTOR = msg({
	message: 'Copy GIF',
	comment: 'Media context menu action that copies a GIF to the clipboard.',
});
const DOWNLOAD_IMAGE_DESCRIPTOR = msg({
	message: 'Download image',
	comment: 'Image context menu action that downloads the image to disk.',
});
const DOWNLOAD_GIF_DESCRIPTOR = msg({
	message: 'Download GIF',
	comment: 'Media context menu action that downloads a GIF to disk.',
});
const COPY_IMAGE_LINK_DESCRIPTOR = msg({
	message: 'Copy image link',
	comment: 'Image context menu action that copies the image URL to the clipboard.',
});
const COPY_GIF_LINK_DESCRIPTOR = msg({
	message: 'Copy GIF link',
	comment: 'Media context menu action that copies the URL of the GIF.',
});
const OPEN_IMAGE_LINK_DESCRIPTOR = msg({
	message: 'Open image link',
	comment: 'Image context menu action that opens the image URL in an external browser.',
});
const OPEN_GIF_LINK_DESCRIPTOR = msg({
	message: 'Open GIF link',
	comment: 'Media context menu action that opens the GIF URL in an external browser.',
});
const MORE_EMOJI_ACTIONS_DESCRIPTOR = msg({
	message: 'More emoji actions',
	comment: 'Submenu label that contains additional emoji context menu actions.',
});

interface EmojiContextMenuItemsProps {
	emoji: FlatEmoji;
	onClose: () => void;
	channelId?: string;
	messageId?: string;
}

const useEmojiHandlers = (emoji: FlatEmoji, onClose: () => void) => {
	const {i18n} = useLingui();
	const canFavorite = !emoji.id || Boolean(emoji.guildId && Guilds.getGuild(emoji.guildId));
	const isFavorite = canFavorite ? EmojiPicker.isFavorite(emoji) : false;
	const originalUrl = emoji.id
		? AvatarUtils.getEmojiOriginalURL({id: emoji.id, animated: emoji.animated})
		: (emoji.url ?? null);

	const copyLabel = emoji.animated ? i18n._(COPY_GIF_DESCRIPTOR) : i18n._(COPY_IMAGE_DESCRIPTOR);
	const downloadLabel = emoji.animated ? i18n._(DOWNLOAD_GIF_DESCRIPTOR) : i18n._(DOWNLOAD_IMAGE_DESCRIPTOR);
	const copyLinkLabel = emoji.animated ? i18n._(COPY_GIF_LINK_DESCRIPTOR) : i18n._(COPY_IMAGE_LINK_DESCRIPTOR);
	const openLinkLabel = emoji.animated ? i18n._(OPEN_GIF_LINK_DESCRIPTOR) : i18n._(OPEN_IMAGE_LINK_DESCRIPTOR);

	const handleToggleFavorite = useCallback(() => {
		EmojiPickerCommands.toggleFavorite(emoji);
	}, [emoji]);

	const handleCopyId = useCallback(() => {
		if (!emoji.id) return;
		TextCopyCommands.copy(i18n, emoji.id);
		onClose();
	}, [i18n, emoji.id, onClose]);

	const handleCopyImage = useCallback(async () => {
		if (!originalUrl) return;
		const mediaType = emoji.animated ? 'gif' : 'image';
		const suggestedFilename = `${emoji.name}.${emoji.animated ? 'gif' : 'png'}`;
		await copyMediaToClipboard({
			i18n,
			originalSrc: originalUrl,
			type: mediaType,
			defaultName: suggestedFilename,
		});
		onClose();
	}, [emoji.animated, emoji.name, i18n, onClose, originalUrl]);

	const handleDownloadImage = useCallback(() => {
		if (!originalUrl) return;
		const mediaType = emoji.animated ? 'gif' : 'image';
		const suggestedFilename = `${emoji.name}.${emoji.animated ? 'gif' : 'png'}`;
		createDownloadHandler(originalUrl, mediaType, suggestedFilename)();
		onClose();
	}, [emoji.animated, emoji.name, onClose, originalUrl]);

	const handleCopyUrl = useCallback(async () => {
		if (!originalUrl) return;
		await TextCopyCommands.copy(i18n, originalUrl, true);
		ToastCommands.createToast({
			type: 'success',
			children: i18n._(LINK_COPIED_TO_CLIPBOARD_DESCRIPTOR),
		});
		onClose();
	}, [i18n, onClose, originalUrl]);

	const handleOpenInBrowser = useCallback(() => {
		if (!originalUrl) return;
		void openExternalUrl(originalUrl);
		onClose();
	}, [onClose, originalUrl]);

	return {
		canFavorite,
		isFavorite,
		originalUrl,
		copyLabel,
		downloadLabel,
		copyLinkLabel,
		openLinkLabel,
		handleToggleFavorite,
		handleCopyId,
		handleCopyImage,
		handleDownloadImage,
		handleCopyUrl,
		handleOpenInBrowser,
	};
};

export const EmojiContextMenuItems = observer(
	({emoji, onClose, channelId: propChannelId, messageId: propMessageId}: EmojiContextMenuItemsProps) => {
		const {i18n} = useLingui();
		const reactionContext = useContext(EmojiPickerReactionContext);
		const resolvedChannelId = propChannelId ?? reactionContext?.channelId ?? ExpressionPicker.channelId ?? undefined;
		const resolvedMessageId =
			propMessageId ??
			reactionContext?.messageId ??
			(resolvedChannelId ? Messages.getMessages(resolvedChannelId).toArray().slice(-1)[0]?.id : undefined);

		const hasPersonas = PersonaStore.personas.length > 0;
		const canReactAs = hasPersonas && Boolean(resolvedChannelId && resolvedMessageId);

		const handleReactAs = useCallback(() => {
			if (!resolvedChannelId || !resolvedMessageId) return;
			onClose();
			ModalCommands.push(
				modal(() => (
					<PersonaReactAsModal
						emoji={emoji}
						channelId={resolvedChannelId}
						messageId={resolvedMessageId}
						onClose={() => ModalCommands.pop()}
						data-flx="ui.action-menu.items.emoji-context-menu-items.handle-react-as.persona-react-as-modal"
					/>
				)),
			);
		}, [emoji, resolvedChannelId, resolvedMessageId, onClose]);

		const {
			canFavorite,
			isFavorite,
			originalUrl,
			copyLabel,
			downloadLabel,
			copyLinkLabel,
			openLinkLabel,
			handleToggleFavorite,
			handleCopyId,
			handleCopyImage,
			handleDownloadImage,
			handleCopyUrl,
			handleOpenInBrowser,
		} = useEmojiHandlers(emoji, onClose);

		const shouldShowSecondaryGroup = canFavorite || Boolean(emoji.id);

		return (
			<>
				{canReactAs && (
					<MenuGroup data-flx="ui.action-menu.items.emoji-context-menu-items.react-as-menu-group">
						<MenuItem
							icon={
								<Smiley
									className={styles.iconSmall}
									weight="bold"
									data-flx="ui.action-menu.items.emoji-context-menu-items.react-as-icon"
								/>
							}
							onClick={handleReactAs}
							data-flx="ui.action-menu.items.emoji-context-menu-items.menu-item.react-as"
						>
							{i18n._(REACT_AS_DESCRIPTOR)}
						</MenuItem>
					</MenuGroup>
				)}
				{originalUrl && (
					<MenuGroup data-flx="ui.action-menu.items.emoji-context-menu-items.media-menu-group">
						<MenuItem
							icon={
								<CopyMediaIcon size={20} data-flx="ui.action-menu.items.emoji-context-menu-items.copy-media-icon" />
							}
							onClick={handleCopyImage}
							data-flx="ui.action-menu.items.emoji-context-menu-items.menu-item.copy-image"
						>
							{copyLabel}
						</MenuItem>
						<MenuItem
							icon={
								<DownloadMediaIcon
									size={20}
									data-flx="ui.action-menu.items.emoji-context-menu-items.download-media-icon"
								/>
							}
							onClick={handleDownloadImage}
							data-flx="ui.action-menu.items.emoji-context-menu-items.menu-item.download-image"
						>
							{downloadLabel}
						</MenuItem>
						<MenuItem
							icon={<CopyLinkIcon size={20} data-flx="ui.action-menu.items.emoji-context-menu-items.copy-link-icon" />}
							onClick={handleCopyUrl}
							data-flx="ui.action-menu.items.emoji-context-menu-items.menu-item.copy-link"
						>
							{copyLinkLabel}
						</MenuItem>
						<MenuItem
							icon={
								<OpenMediaLinkIcon
									size={20}
									data-flx="ui.action-menu.items.emoji-context-menu-items.open-media-link-icon"
								/>
							}
							onClick={handleOpenInBrowser}
							data-flx="ui.action-menu.items.emoji-context-menu-items.menu-item.open-link"
						>
							{openLinkLabel}
						</MenuItem>
					</MenuGroup>
				)}
				{shouldShowSecondaryGroup && (
					<MenuGroup data-flx="ui.action-menu.items.emoji-context-menu-items.menu-group">
						{canFavorite && (
							<MenuItem
								icon={
									<StarIcon
										className={styles.iconSmall}
										weight={isFavorite ? 'fill' : 'bold'}
										data-flx="ui.action-menu.items.emoji-context-menu-items.icon-small"
									/>
								}
								onClick={handleToggleFavorite}
								data-flx="ui.action-menu.items.emoji-context-menu-items.menu-item.toggle-favorite"
							>
								{isFavorite ? i18n._(UNFAVORITE_EMOJI_DESCRIPTOR) : i18n._(FAVORITE_EMOJI_DESCRIPTOR)}
							</MenuItem>
						)}
						{emoji.id && (
							<CloneEmojiMenuItem
								emoji={emoji}
								onClose={onClose}
								data-flx="ui.action-menu.items.emoji-context-menu-items.clone-emoji-menu-item"
							/>
						)}
						{emoji.id && (
							<MenuItem
								icon={
									<ClipboardIcon
										className={styles.iconSmall}
										data-flx="ui.action-menu.items.emoji-context-menu-items.icon-small--2"
									/>
								}
								onClick={handleCopyId}
								data-flx="ui.action-menu.items.emoji-context-menu-items.menu-item.copy-id"
							>
								{i18n._(COPY_EMOJI_ID_DESCRIPTOR)}
							</MenuItem>
						)}
					</MenuGroup>
				)}
				{originalUrl && (
					<ReverseImageSearchMenuItems
						imageUrl={originalUrl}
						onClose={onClose}
						wrapInGroup
						includeCopyAndOpen={false}
						data-flx="ui.action-menu.items.emoji-context-menu-items.reverse-image-search-menu-items"
					/>
				)}
			</>
		);
	},
);

EmojiContextMenuItems.displayName = 'EmojiContextMenuItems';

export const EmojiInlineMenuItems = observer(
	({emoji, onClose, channelId: propChannelId, messageId: propMessageId}: EmojiContextMenuItemsProps) => {
		const {i18n} = useLingui();
		const reactionContext = useContext(EmojiPickerReactionContext);
		const resolvedChannelId = propChannelId ?? reactionContext?.channelId ?? ExpressionPicker.channelId ?? undefined;
		const resolvedMessageId =
			propMessageId ??
			reactionContext?.messageId ??
			(resolvedChannelId ? Messages.getMessages(resolvedChannelId).toArray().slice(-1)[0]?.id : undefined);

		const hasPersonas = PersonaStore.personas.length > 0;
		const canReactAs = hasPersonas && Boolean(resolvedChannelId && resolvedMessageId);

		const handleReactAs = useCallback(() => {
			if (!resolvedChannelId || !resolvedMessageId) return;
			onClose();
			ModalCommands.push(
				modal(() => (
					<PersonaReactAsModal
						emoji={emoji}
						channelId={resolvedChannelId}
						messageId={resolvedMessageId}
						onClose={() => ModalCommands.pop()}
						data-flx="ui.action-menu.items.emoji-context-menu-items.handle-react-as.persona-react-as-modal--2"
					/>
				)),
			);
		}, [emoji, resolvedChannelId, resolvedMessageId, onClose]);

		const {
			canFavorite,
			isFavorite,
			originalUrl,
			copyLabel,
			downloadLabel,
			copyLinkLabel,
			openLinkLabel,
			handleToggleFavorite,
			handleCopyId,
			handleCopyImage,
			handleDownloadImage,
			handleCopyUrl,
			handleOpenInBrowser,
		} = useEmojiHandlers(emoji, onClose);

		if (!canFavorite && !emoji.id && !originalUrl && !canReactAs) {
			return null;
		}

		const showSubmenu = Boolean(emoji.id) || Boolean(originalUrl);

		return (
			<MenuGroup data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-group">
				{canReactAs && (
					<MenuItem
						onClick={handleReactAs}
						data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item.react-as"
					>
						{i18n._(REACT_AS_DESCRIPTOR)}
					</MenuItem>
				)}
				{originalUrl && (
					<MenuItem
						onClick={handleCopyImage}
						data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item.copy-image"
					>
						{copyLabel}
					</MenuItem>
				)}
				{originalUrl && (
					<MenuItem
						onClick={handleDownloadImage}
						data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item.download-image"
					>
						{downloadLabel}
					</MenuItem>
				)}
				{originalUrl && (
					<MenuItem
						onClick={handleCopyUrl}
						data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item.copy-url"
					>
						{copyLinkLabel}
					</MenuItem>
				)}
				{originalUrl && (
					<MenuItem
						onClick={handleOpenInBrowser}
						data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item.open-in-browser"
					>
						{openLinkLabel}
					</MenuItem>
				)}
				{canFavorite && (
					<MenuItem
						onClick={handleToggleFavorite}
						data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item.toggle-favorite"
					>
						{isFavorite ? i18n._(UNFAVORITE_EMOJI_DESCRIPTOR) : i18n._(FAVORITE_EMOJI_DESCRIPTOR)}
					</MenuItem>
				)}
				{showSubmenu && (
					<MenuItemSubmenu
						label={i18n._(MORE_EMOJI_ACTIONS_DESCRIPTOR)}
						render={() => (
							<>
								{emoji.id && (
									<MenuGroup data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-group--2">
										<MenuItem
											icon={
												<ClipboardIcon
													className={styles.iconSmall}
													data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.icon-small"
												/>
											}
											onClick={handleCopyId}
											data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item.copy-id"
										>
											{i18n._(COPY_EMOJI_ID_DESCRIPTOR)}
										</MenuItem>
									</MenuGroup>
								)}
								{emoji.id && (
									<CloneEmojiMenuItem
										emoji={emoji}
										onClose={onClose}
										data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.clone-emoji-menu-item"
									/>
								)}
								{originalUrl && (
									<ReverseImageSearchMenuItems
										imageUrl={originalUrl}
										onClose={onClose}
										wrapInGroup
										includeCopyAndOpen={false}
										data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.reverse-image-search-menu-items"
									/>
								)}
							</>
						)}
						data-flx="ui.action-menu.items.emoji-context-menu-items.emoji-inline-menu-items.menu-item-submenu"
					/>
				)}
			</MenuGroup>
		);
	},
);

EmojiInlineMenuItems.displayName = 'EmojiInlineMenuItems';
