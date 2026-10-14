// SPDX-License-Identifier: AGPL-3.0-or-later

import {type PersonaAvatarSource, personaAvatarUrls} from '@app/features/persona/utils/PersonaAvatarUrls';
import {Avatar} from '@app/features/ui/components/Avatar';
import {observer} from 'mobx-react-lite';
import React, {useMemo} from 'react';

type AvatarProps = React.ComponentProps<typeof Avatar>;

export type PersonaAvatarProps = Omit<AvatarProps, 'avatarUrl' | 'hoverAvatarUrl'> & {
	/**
	 * The persona whose avatar to show, as its display copy. Absent, or a persona without an avatar
	 * of its own, shows the account's avatar.
	 */
	persona?: PersonaAvatarSource | null;
};

/**
 * Fork: upstream's `<Avatar>` for a persona. `user` is the account the persona belongs to, as with
 * `<Avatar>`; the persona's avatar is read from `persona`, the way `<Avatar>` reads `user.avatar`.
 * Everything else is passed to `<Avatar>` unchanged.
 */
export const PersonaAvatar = observer(
	React.forwardRef<HTMLDivElement, PersonaAvatarProps>(({persona, ...props}, ref) => {
		const ownerUserId = props.user.id;
		const avatarHash = persona?.avatar;
		const urls = useMemo(
			() => personaAvatarUrls(ownerUserId, {avatar: avatarHash}, props.mediaSize),
			[ownerUserId, avatarHash, props.mediaSize],
		);
		return <Avatar ref={ref} data-flx="persona.persona-avatar.avatar" {...props} {...urls} />;
	}),
);
