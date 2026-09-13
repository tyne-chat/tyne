// SPDX-License-Identifier: AGPL-3.0-or-later

import {useMaybeMessageViewContext} from '@app/features/channel/components/MessageViewContext';
import {PreloadableUserPopout} from '@app/features/channel/components/PreloadableUserPopout';
import type {Guild} from '@app/features/guild/models/Guild';
import {isKeyboardActivationKey} from '@app/features/input/utils/KeyboardUtils';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import styles from '@app/features/theme/styles/Message.module.css';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import KeyboardMode from '@app/features/ui/state/KeyboardMode';
import type {User} from '@app/features/user/models/User';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useRef} from 'react';
import {MessageAvatar} from './MessageAvatar';

export const MessagePersonaAccount = observer(
	({
		user,
		message,
		guild,
		member,
		className,
		customIconUrl,
	}: {
		user: User;
		message: Message;
		guild?: Guild;
		member?: GuildMember;
		className?: string;
		isPreview?: boolean;
		previewColor?: string;
		previewName?: string;
		customIconUrl?: string | null;
	}) => {
		const usernameRef = useRef<HTMLSpanElement | null>(null);
		//const contextMenuOpen = useContextMenuHoverState(usernameRef);
		// const displayName = previewName || NicknameUtils.getNickname(user, guild?.id, message.channelId);
		const displayName = NicknameUtils.getNickname(user, guild?.id, message.channelId);
		// const color = previewColor || member?.getColorString();
		const onPopoutToggle = useMaybeMessageViewContext()?.onPopoutToggle;
		const handlePopoutOpen = useCallback(() => onPopoutToggle?.(true), [onPopoutToggle]);
		const handlePopoutClose = useCallback(() => onPopoutToggle?.(false), [onPopoutToggle]);
		const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
			if (e.defaultPrevented) return;
			if (!isKeyboardActivationKey(e.key)) return;
			e.preventDefault();
			(e.currentTarget as HTMLElement).click();
		}, []);
		const keyboardModeEnabled = KeyboardMode.keyboardModeEnabled;
		if (!message.subprofile) return null;

		return (
			<PreloadableUserPopout
				user={user}
				isWebhook={message.webhookId != null}
				webhookId={message.webhookId ?? undefined}
				guildId={guild?.id}
				guildMember={member}
				channelId={message.channelId}
				message={message}
				enableLongPressActions={true}
				longPressWrapperElement="span"
				onPopoutOpen={handlePopoutOpen}
				onPopoutClose={handlePopoutClose}
				ignoreSubprofile={true}
				data-flx="channel.message-username.preloadable-user-popout"
			>
				<FocusRing data-flx="channel.message-username-original.focus-ring">
					{/* biome-ignore lint/a11y/noStaticElementInteractions: the username span is only keyboard-interactive in keyboard mode (role="button"/tabIndex set conditionally); pointer/popout/context-menu interactions are handled by the wrapping PreloadableUserPopout. */}
					{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the username span role is conditionally button */}
					<span
						data-user-id={user.id}
						data-guild-id={guild?.id}
						tabIndex={keyboardModeEnabled ? 0 : undefined}
						role={keyboardModeEnabled ? 'button' : undefined}
						ref={usernameRef}
						onKeyDown={handleKeyDown}
						data-flx="channel.message-username.context-menu-underline.key-down"
						aria-label={displayName}
					>
						{customIconUrl ? (
							<img
								src={customIconUrl}
								alt=""
								className={clsx(styles.messageAvatarCompact, styles.messageSubprofileMainAvatar, className)}
								style={{width: 16, height: 16, borderRadius: '50%', objectFit: 'cover'}}
								data-flx="channel.user-message.message-avatar-subprofile-custom-icon"
							/>
						) : (
							<MessageAvatar
								user={user}
								message={message}
								guildId={guild?.id}
								size={16}
								className={clsx(styles.messageAvatarCompact, styles.messageSubprofileMainAvatar, className)}
								isHovering={/*isHovering*/ false}
								isPreview={/*!!previewContext*/ false}
								ignoreSubprofile={true}
								data-flx="channel.user-message.message-avatar-subprofile-main-account"
							/>
						)}
					</span>
				</FocusRing>
			</PreloadableUserPopout>
		);
	},
);

export const MessageSubprofileAccount = MessagePersonaAccount;
