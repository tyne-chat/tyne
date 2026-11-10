// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaTag} from '@app/features/persona/components/PersonaTag';
import * as M from '@app/features/persona/utils/PersonaGalleryMessages';
import {openPersonaGallery} from '@app/features/persona/utils/PersonaGalleryOpen';
import {usePersonaDirectory} from '@app/features/persona/utils/usePersonaDirectory';
import sheetStyles from '@app/features/user/components/modals/UserProfileMobileSheet.module.css';
import type {User} from '@app/features/user/models/User';
import {useLingui} from '@lingui/react/macro';
import {UsersThreeIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import styles from './PersonasPill.module.css';

interface PersonasPillProps {
	user: User;
	guildId?: string;
	/** Runs before the gallery opens, such as closing the popout the pill is in. */
	onBeforeOpen?: () => void;
	/** The full profile of this account is already open: switch its tab instead of opening another. */
	inProfile?: boolean;
	className?: string;
}

/**
 * "Personas (12)" after the display tag on a profile (tyne-chat/tyne#189). It opens the account's
 * Personas tab or sheet. Shown when the account has a public persona; on one's own profile, always.
 * It costs at most one request per account a minute, shared with the tab (`usePersonaDirectory`).
 */
export const PersonasPill = observer(
	({user, guildId, onBeforeOpen, inProfile = false, className}: PersonasPillProps) => {
		const {i18n} = useLingui();
		const directory = usePersonaDirectory(user.bot || user.system ? null : user.id);
		if (user.bot || user.system) return null;
		if (!directory.isOwn && directory.publicCount === 0) return null;
		return (
			<button
				type="button"
				className={clsx(styles.pill, className)}
				onClick={(event) => {
					event.stopPropagation();
					onBeforeOpen?.();
					openPersonaGallery(user, {guildId, profileOpen: inProfile});
				}}
				data-flx="persona.personas-pill"
			>
				<UsersThreeIcon size={13} weight="bold" className={styles.icon} data-flx="persona.personas-pill.icon" />
				{i18n._(M.PERSONAS_COUNT_DESCRIPTOR, {count: directory.publicCount})}
			</button>
		);
	},
);

/** The row after a name on a profile: the display tag and the Personas pill, wrapping when narrow. */
export const PersonaNameExtras = ({children}: {children: React.ReactNode}) => (
	<span className={styles.extras} data-flx="persona.name-extras">
		{children}
	</span>
);

interface AccountPersonaNameExtrasProps extends PersonasPillProps {
	isHovering?: boolean;
}

/**
 * What follows an account's name on its profile: its display tag, which only its personas showed
 * until 2026-11-07, then the Personas pill (tyne-chat/tyne#189). Nothing for bots and webhooks.
 */
export const AccountPersonaNameExtras = observer((props: AccountPersonaNameExtrasProps) => {
	const {user, isHovering, guildId, onBeforeOpen, inProfile} = props;
	const directory = usePersonaDirectory(user.bot || user.system ? null : user.id);
	if (user.bot || user.system) return null;
	const hasTag = Boolean(directory.displayTagText || directory.displayTagIcon);
	return (
		<PersonaNameExtras data-flx="persona.account-name-extras">
			{hasTag && (
				<PersonaTag
					subprofile={{
						id: user.id,
						name: user.displayName,
						avatar: null,
						display_tag_text: directory.displayTagText,
						display_tag_icon: directory.displayTagIcon,
					}}
					rootUser={user}
					isHovering={isHovering}
					guildId={guildId}
					onBeforeOpenProfile={onBeforeOpen}
					inProfile={inProfile}
					className={styles.tag}
					data-flx="persona.account-name-extras.tag"
				/>
			)}
			<PersonasPill {...props} data-flx="persona.account-name-extras.pill" />
		</PersonaNameExtras>
	);
});

/** Fork props of upstream's `ProfileCardUserInfo`: what follows the name on a profile card. */
export interface ForkProfileCardUserInfoProps {
	personaNameExtras?: React.ReactNode;
}

/**
 * "Personas (12)" above the mutual friends on a profile sheet on phones (mobile web), in the same
 * rounded group and row style as upstream's mutual buttons. Shown when the pill is.
 */
export const PersonasProfileSheetButton = observer(({user}: {user: User}) => {
	const {i18n} = useLingui();
	const directory = usePersonaDirectory(user.bot || user.system ? null : user.id);
	if (user.bot || user.system) return null;
	if (!directory.isOwn && directory.publicCount === 0) return null;
	return (
		<div className={sheetStyles.mutualButtonsGroup} data-flx="persona.personas-sheet-button.group">
			<button
				type="button"
				className={sheetStyles.mutualButton}
				onClick={() => openPersonaGallery(user)}
				data-flx="persona.personas-sheet-button"
			>
				<span className={sheetStyles.mutualButtonLabel} data-flx="persona.personas-sheet-button.label">
					{i18n._(M.PERSONAS_COUNT_DESCRIPTOR, {count: directory.publicCount})}
				</span>
			</button>
		</div>
	);
});
