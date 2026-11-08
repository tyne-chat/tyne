// SPDX-License-Identifier: AGPL-3.0-or-later

import {useHover} from '@app/features/app/hooks/useHover';
import {useShouldAnimate} from '@app/features/app/hooks/useShouldAnimate';
import Authentication from '@app/features/auth/state/Authentication';
import {MessagePersonaAccount} from '@app/features/channel/components/MessagePersonaAccount';
import type {Guild} from '@app/features/guild/models/Guild';
import {isKeyboardActivationKey} from '@app/features/input/utils/KeyboardUtils';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {personaTagIconUrls} from '@app/features/persona/utils/PersonaTagIconUrls';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import type {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import styles from './PersonaTag.module.css';

interface PersonaTagProps {
	subprofile: MessageSubprofileResponse;
	rootUser?: User | null;
	className?: string;
	message?: Message;
	guild?: Guild;
	member?: GuildMember;
	isHovering?: boolean;
	/** The server to open the account's profile in, where no `guild` is given (profiles and popouts). */
	guildId?: string;
	/** Runs before the account's profile opens, such as closing the popout the tag is in. */
	onBeforeOpenProfile?: () => void;
	/**
	 * The tag is inside the account's own profile window, which a click would open again on top
	 * (tyne-chat/tyne#576): it is not a button there.
	 */
	inProfile?: boolean;
}

export const PersonaTag: React.FC<PersonaTagProps> = observer(
	({
		subprofile,
		rootUser,
		className,
		message,
		guild,
		member,
		isHovering: propIsHovering,
		guildId,
		onBeforeOpenProfile,
		inProfile = false,
	}) => {
		const {i18n} = useLingui();
		const currentUserId = Authentication.currentUserId ?? Users.currentUser?.id;
		const isCurrentUser = Boolean(currentUserId && rootUser?.id && rootUser.id === currentUserId);
		const tagText = (
			subprofile.display_tag_text ??
			(isCurrentUser && !message ? PersonaStore.displayTagText : '') ??
			''
		).trim();
		const rawIcon = subprofile.display_tag_icon ?? (isCurrentUser && !message ? PersonaStore.displayTagIcon : null);
		const tagIcon = rawIcon?.trim() || null;

		const [tagHoverRef, isTagHovering] = useHover();

		const iconUrls = personaTagIconUrls(rootUser?.id, tagIcon);
		const staticIconUrl = iconUrls?.staticUrl ?? null;
		const hoverIconUrl = iconUrls?.hoverUrl ?? null;

		const hasDistinctHover = Boolean(hoverIconUrl && hoverIconUrl !== staticIconUrl);
		const shouldAnimate = useShouldAnimate({
			kind: 'avatar',
			isAnimated: hasDistinctHover,
			isHovering: hasDistinctHover && (isTagHovering || Boolean(propIsHovering)),
		});
		const resolvedTagIcon = shouldAnimate ? hoverIconUrl : staticIconUrl;

		// When message and rootUser are present (standard chat message rendering):
		// Delegate to MessagePersonaAccount for unified popout, context menu, and tooltip across all variations
		if (message && rootUser) {
			return (
				<MessagePersonaAccount
					user={rootUser}
					message={message}
					guild={guild}
					member={member}
					tagIcon={tagIcon}
					tagText={tagText || null}
					className={className}
					isHovering={propIsHovering}
					data-flx="persona.persona-tag.message-persona-account"
				/>
			);
		}

		// Without a root user there is no account to serve the icon from, so only the text shows.
		if (!rootUser) {
			if (!tagText) return null;
			return (
				<span className={clsx(styles.tag, className)} data-flx="persona.tag">
					<span className={styles.text} data-flx="persona.persona-tag.text">
						{tagText}
					</span>
				</span>
			);
		}

		// Fallback for previews or contexts without a full message object (e.g., inside PersonaProfilePopout)
		const tooltipText = rootUser.username
			? i18n._(
					msg({
						message: 'Account: @{username}',
						comment: 'Tooltip showing root account username',
					}),
					{username: rootUser.username},
				)
			: undefined;
		const openRootProfile = () => {
			onBeforeOpenProfile?.();
			UserProfileCommands.openUserProfile(rootUser.id, guild?.id ?? guildId);
		};
		const handleFallbackClick = (e: React.MouseEvent) => {
			e.stopPropagation();
			openRootProfile();
		};
		const handleFallbackKeyDown = (e: React.KeyboardEvent) => {
			if (isKeyboardActivationKey(e.key)) {
				e.preventDefault();
				e.stopPropagation();
				openRootProfile();
			}
		};
		const buttonProps = inProfile
			? {}
			: {onClick: handleFallbackClick, onKeyDown: handleFallbackKeyDown, role: 'button', tabIndex: 0};
		const wrapperStyle: React.CSSProperties = {
			cursor: inProfile ? 'default' : 'pointer',
			display: 'inline-flex',
			verticalAlign: 'middle',
		};

		if (tagText) {
			const pill = (
				<span
					ref={tagHoverRef}
					className={clsx(styles.tag, inProfile && styles.inProfile, className)}
					data-flx="persona.tag"
					{...buttonProps}
				>
					{resolvedTagIcon && (
						<img src={resolvedTagIcon} alt="" className={styles.icon} data-flx="persona.persona-tag.icon--2" />
					)}
					<span className={styles.text} data-flx="persona.persona-tag.text--2">
						{tagText}
					</span>
				</span>
			);

			return tooltipText ? (
				<Tooltip text={tooltipText} position="top" data-flx="persona.persona-tag.tooltip">
					{pill}
				</Tooltip>
			) : (
				pill
			);
		}

		if (resolvedTagIcon) {
			const iconElement = (
				<span ref={tagHoverRef} {...buttonProps} style={wrapperStyle} data-flx="persona.standalone-icon">
					<img
						src={resolvedTagIcon}
						alt=""
						className={clsx(styles.standaloneIcon, inProfile && styles.inProfile, className)}
						data-flx="persona.persona-tag.standalone-icon"
					/>
				</span>
			);
			return tooltipText ? (
				<Tooltip text={tooltipText} position="top" data-flx="persona.persona-tag.tooltip--2">
					{iconElement}
				</Tooltip>
			) : (
				iconElement
			);
		}

		const avatarElement = (
			<span
				ref={tagHoverRef}
				{...buttonProps}
				style={wrapperStyle}
				data-flx="persona.persona-tag.button.fallback-click"
			>
				<Avatar
					user={rootUser}
					size={16}
					className={clsx(styles.standaloneIcon, inProfile && styles.inProfile, className)}
					disableStatusTooltip={true}
					forceAnimate={isTagHovering || Boolean(propIsHovering)}
					data-flx="persona.persona-tag.standalone-icon--2"
				/>
			</span>
		);
		return tooltipText ? (
			<Tooltip text={tooltipText} position="top" data-flx="persona.persona-tag.tooltip--3">
				{avatarElement}
			</Tooltip>
		) : (
			avatarElement
		);
	},
);
