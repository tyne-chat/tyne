// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import {MessagePersonaAccount} from '@app/features/channel/components/MessagePersonaAccount';
import type {Guild} from '@app/features/guild/models/Guild';
import {isKeyboardActivationKey} from '@app/features/input/utils/KeyboardUtils';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
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
}

export const PersonaTag: React.FC<PersonaTagProps> = observer(
	({subprofile, rootUser, className, message, guild, member}) => {
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

		// When message and rootUser are present (standard chat message rendering):
		// Delegate to MessagePersonaAccount for unified popout, context menu, and tooltip across all variations
		if (message && rootUser) {
			return (
				<MessagePersonaAccount
					user={rootUser}
					message={message}
					guild={guild}
					member={member}
					customIconUrl={tagIcon}
					tagText={tagText || null}
					className={className}
					data-flx="persona.persona-tag.message-persona-account"
				/>
			);
		}

		// When no rootUser is available, render static markup if tagText or tagIcon exists
		if (!rootUser) {
			if (tagText) {
				return (
					<span className={clsx(styles.tag, className)} data-flx="persona.tag">
						{tagIcon && <img src={tagIcon} alt="" className={styles.icon} data-flx="persona.persona-tag.icon" />}
						<span className={styles.text} data-flx="persona.persona-tag.text">
							{tagText}
						</span>
					</span>
				);
			}
			if (tagIcon) {
				return (
					<img
						src={tagIcon}
						alt=""
						className={clsx(styles.standaloneIcon, className)}
						data-flx="persona.standalone-icon"
					/>
				);
			}
			return null;
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
		const handleFallbackClick = (e: React.MouseEvent) => {
			e.stopPropagation();
			UserProfileCommands.openUserProfile(rootUser.id, guild?.id);
		};
		const handleFallbackKeyDown = (e: React.KeyboardEvent) => {
			if (isKeyboardActivationKey(e.key)) {
				e.preventDefault();
				e.stopPropagation();
				UserProfileCommands.openUserProfile(rootUser.id, guild?.id);
			}
		};

		if (tagText) {
			const pill = (
				<span
					className={clsx(styles.tag, className)}
					data-flx="persona.tag"
					onClick={handleFallbackClick}
					onKeyDown={handleFallbackKeyDown}
					role="button"
					tabIndex={0}
				>
					{tagIcon && <img src={tagIcon} alt="" className={styles.icon} data-flx="persona.persona-tag.icon--2" />}
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

		if (tagIcon) {
			const iconElement = (
				<span
					onClick={handleFallbackClick}
					onKeyDown={handleFallbackKeyDown}
					role="button"
					tabIndex={0}
					style={{cursor: 'pointer', display: 'inline-flex', verticalAlign: 'middle'}}
					data-flx="persona.standalone-icon"
				>
					<img
						src={tagIcon}
						alt=""
						className={clsx(styles.standaloneIcon, className)}
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
				onClick={handleFallbackClick}
				onKeyDown={handleFallbackKeyDown}
				role="button"
				tabIndex={0}
				style={{cursor: 'pointer', display: 'inline-flex', verticalAlign: 'middle'}}
				data-flx="persona.persona-tag.button.fallback-click"
			>
				<Avatar
					user={rootUser}
					size={16}
					className={clsx(styles.standaloneIcon, className)}
					disableStatusTooltip={true}
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

export const SubprofileTag = PersonaTag;
