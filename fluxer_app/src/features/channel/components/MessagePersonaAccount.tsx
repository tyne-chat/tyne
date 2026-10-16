// SPDX-License-Identifier: AGPL-3.0-or-later

import {useHover} from '@app/features/app/hooks/useHover';
import {useMergeRefs} from '@app/features/app/hooks/useMergeRefs';
import {useShouldAnimate} from '@app/features/app/hooks/useShouldAnimate';
import {useMaybeMessageViewContext} from '@app/features/channel/components/MessageViewContext';
import {PreloadableUserPopout} from '@app/features/channel/components/PreloadableUserPopout';
import type {Guild} from '@app/features/guild/models/Guild';
import {isKeyboardActivationKey} from '@app/features/input/utils/KeyboardUtils';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import tagStyles from '@app/features/persona/components/PersonaTag.module.css';
import styles from '@app/features/theme/styles/Message.module.css';
import {Avatar} from '@app/features/ui/components/Avatar';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import KeyboardMode from '@app/features/ui/state/KeyboardMode';
import type {User} from '@app/features/user/models/User';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useRef} from 'react';

export const MessagePersonaAccount = observer(
	({
		user,
		message,
		guild,
		member,
		className,
		customIconUrl,
		tagText,
		isHovering: forceAnimate,
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
		tagText?: string | null;
		isHovering?: boolean;
	}) => {
		const usernameRef = useRef<HTMLSpanElement | null>(null);
		const [tagHoverRef, isTagHovering] = useHover();
		const mergedRef = useMergeRefs([usernameRef, tagHoverRef]);
		const displayName = NicknameUtils.getNickname(user, guild?.id, message.channelId);
		const tooltipText = user.username ? `Account: @${user.username}` : undefined;
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

		const staticIconUrl = customIconUrl
			? customIconUrl.startsWith('http://') || customIconUrl.startsWith('https://') || customIconUrl.startsWith('data:')
				? customIconUrl
				: AvatarUtils.getUserAvatarURL({id: user.id, avatar: customIconUrl}, false, 32)
			: null;

		const hoverIconUrl = customIconUrl
			? customIconUrl.startsWith('http://') || customIconUrl.startsWith('https://') || customIconUrl.startsWith('data:')
				? customIconUrl
				: AvatarUtils.getUserAvatarURL({id: user.id, avatar: customIconUrl}, true, 32)
			: null;

		const hasDistinctHover = Boolean(hoverIconUrl && hoverIconUrl !== staticIconUrl);
		const shouldAnimate = useShouldAnimate({
			kind: 'avatar',
			isAnimated: hasDistinctHover,
			isHovering: hasDistinctHover && (isTagHovering || Boolean(forceAnimate)),
		});
		const resolvedIconUrl = shouldAnimate ? hoverIconUrl : staticIconUrl;

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
				tooltip={tooltipText}
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
						ref={mergedRef}
						onKeyDown={handleKeyDown}
						data-flx="channel.message-username.context-menu-underline.key-down"
						aria-label={tooltipText || displayName}
						style={{cursor: 'pointer', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle'}}
					>
						{tagText ? (
							<span className={clsx(tagStyles.tag, className)} data-flx="persona.tag">
								{resolvedIconUrl && (
									<img
										src={resolvedIconUrl}
										alt=""
										className={tagStyles.icon}
										data-flx="channel.message-persona-account.img"
									/>
								)}
								<span className={tagStyles.text} data-flx="channel.message-persona-account.span">
									{tagText}
								</span>
							</span>
						) : resolvedIconUrl ? (
							<img
								src={resolvedIconUrl}
								alt=""
								className={clsx(
									styles.messageAvatarCompact,
									styles.messageSubprofileMainAvatar,
									tagStyles.standaloneIcon,
									className,
								)}
								style={{width: 16, height: 16, borderRadius: '50%', objectFit: 'cover'}}
								data-flx="channel.user-message.message-avatar-subprofile-custom-icon"
							/>
						) : (
							<Avatar
								user={user}
								size={16}
								className={clsx(
									styles.messageAvatarCompact,
									styles.messageSubprofileMainAvatar,
									tagStyles.standaloneIcon,
									className,
								)}
								guildId={guild?.id}
								forceAnimate={Boolean(forceAnimate)}
								disableStatusTooltip={true}
								data-flx="channel.user-message.message-avatar-subprofile-main-account"
							/>
						)}
					</span>
				</FocusRing>
			</PreloadableUserPopout>
		);
	},
);
