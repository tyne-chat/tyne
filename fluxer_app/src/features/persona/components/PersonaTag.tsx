// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import {MessagePersonaAccount} from '@app/features/channel/components/MessagePersonaAccount';
import type {Guild} from '@app/features/guild/models/Guild';
import type {GuildMember} from '@app/features/member/models/GuildMember';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import type {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
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
		const currentUserId = Authentication.currentUserId ?? Users.currentUser?.id;
		const isCurrentUser = Boolean(currentUserId && rootUser?.id && rootUser.id === currentUserId);
		const tagText = (
			subprofile.display_tag_text ??
			subprofile.system_name ??
			(isCurrentUser && !message ? PersonaStore.displayTagText : '') ??
			''
		).trim();
		const rawIcon = subprofile.display_tag_icon ?? (isCurrentUser && !message ? PersonaStore.displayTagIcon : null);
		const tagIcon = rawIcon?.trim() || null;

		// When display tag text is present, render the tag pill markup.
		if (tagText) {
			const tooltipText = rootUser?.username ? `Account: @${rootUser.username}` : undefined;
			const pill = (
				<span className={clsx(styles.tag, className)} data-flx="persona.tag">
					{tagIcon && <img src={tagIcon} alt="" className={styles.icon} data-flx="persona.persona-tag.icon" />}
					<span className={styles.text} data-flx="persona.persona-tag.text">
						{tagText}
					</span>
				</span>
			);

			if (tooltipText) {
				return (
					<Tooltip text={tooltipText} position="top" data-flx="persona.persona-tag.tooltip">
						{pill}
					</Tooltip>
				);
			}
			return pill;
		}

		// When NO display tag text is present:
		// If custom tagIcon is present, or if neither is set (defaulting to owner account icon):
		// The icon sits by itself, just like the owner account icon did before.
		if (message && rootUser) {
			return (
				<MessagePersonaAccount
					user={rootUser}
					message={message}
					guild={guild}
					member={member}
					customIconUrl={tagIcon}
					className={className}
					data-flx="persona.persona-tag.message-persona-account"
				/>
			);
		}

		// Fallback for previews or contexts without a full message object:
		if (tagIcon) {
			const tooltipText = rootUser?.username ? `Account: @${rootUser.username}` : undefined;
			const iconElement = (
				<img
					src={tagIcon}
					alt=""
					className={clsx(styles.standaloneIcon, className)}
					data-flx="persona.standalone-icon"
				/>
			);
			return tooltipText ? (
				<Tooltip text={tooltipText} position="top" data-flx="persona.persona-tag.tooltip--2">
					{iconElement}
				</Tooltip>
			) : (
				iconElement
			);
		}

		if (rootUser) {
			const tooltipText = rootUser?.username ? `Account: @${rootUser.username}` : undefined;
			const avatarElement = (
				<Avatar
					user={rootUser}
					size={16}
					className={clsx(styles.standaloneIcon, className)}
					disableStatusTooltip={true}
					data-flx="persona.persona-tag.standalone-icon"
				/>
			);
			return tooltipText ? (
				<Tooltip text={tooltipText} position="top" data-flx="persona.persona-tag.tooltip--3">
					{avatarElement}
				</Tooltip>
			) : (
				avatarElement
			);
		}

		return null;
	},
);

export const SubprofileTag = PersonaTag;
