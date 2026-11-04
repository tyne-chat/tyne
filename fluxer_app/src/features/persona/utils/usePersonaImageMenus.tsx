// SPDX-License-Identifier: AGPL-3.0-or-later

import {getUserMenuAvatarUrl, UserImageMenuItems} from '@app/features/ui/action_menu/items/UserImageMenuItems';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import type {User} from '@app/features/user/models/User';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import type {ProfileDisplayContext, ProfilePreviewOverrides} from '@app/features/user/utils/ProfileDisplayUtils';
import type React from 'react';
import {useCallback, useMemo} from 'react';

interface PersonaImageMenusOptions {
	user: User;
	/** The persona's avatar hash; without one the profile shows, and the menu offers, the account's. */
	avatarHash: string | null | undefined;
	/** The persona's banner hash; without one there is no banner, and no banner menu. */
	bannerHash: string | null | undefined;
}

interface PersonaImageMenus {
	onAvatarContextMenu: ((event: React.MouseEvent) => void) | undefined;
	onBannerContextMenu: ((event: React.MouseEvent) => void) | undefined;
}

/**
 * Fork: the right-click menus of a persona profile's avatar and banner (tyne-chat/tyne#473), the
 * account profile's own: upstream's `UserImageMenuItems` with the persona's images handed in as
 * preview overrides, which that menu shows ahead of the account's. Its addresses go through
 * `toOriginalImageUrl`, so they open the stored image (tyne-chat/tyne#471).
 *
 * No requests: the addresses are built from the hashes the profile already has.
 */
export function usePersonaImageMenus({user, avatarHash, bannerHash}: PersonaImageMenusOptions): PersonaImageMenus {
	const profileContext = useMemo<ProfileDisplayContext>(() => ({user}), [user]);
	const avatarOverrides = useMemo<ProfilePreviewOverrides>(
		() => ({previewAvatarUrl: AvatarUtils.getPersonaAvatarURL({userId: user.id, avatar: avatarHash}) || null}),
		[user.id, avatarHash],
	);
	const bannerOverrides = useMemo<ProfilePreviewOverrides>(
		() => ({previewBannerUrl: AvatarUtils.getPersonaBannerURL({userId: user.id, banner: bannerHash}) || null}),
		[user.id, bannerHash],
	);
	const hasAvatarMenu = Boolean(getUserMenuAvatarUrl({user, profileContext, previewOverrides: avatarOverrides}));
	const hasBannerMenu = Boolean(bannerOverrides.previewBannerUrl);
	const onAvatarContextMenu = useCallback(
		(event: React.MouseEvent) => {
			ContextMenuCommands.openFromEvent(event, ({onClose}) => (
				<UserImageMenuItems
					user={user}
					profileContext={profileContext}
					previewOverrides={avatarOverrides}
					onClose={onClose}
					variant="avatar"
					data-flx="persona.persona-image-menus.avatar-context-menu.user-image-menu-items"
				/>
			));
		},
		[user, profileContext, avatarOverrides],
	);
	const onBannerContextMenu = useCallback(
		(event: React.MouseEvent) => {
			ContextMenuCommands.openFromEvent(event, ({onClose}) => (
				<UserImageMenuItems
					user={user}
					profileContext={profileContext}
					previewOverrides={bannerOverrides}
					onClose={onClose}
					variant="banner"
					data-flx="persona.persona-image-menus.banner-context-menu.user-image-menu-items"
				/>
			));
		},
		[user, profileContext, bannerOverrides],
	);
	return {
		onAvatarContextMenu: hasAvatarMenu ? onAvatarContextMenu : undefined,
		onBannerContextMenu: hasBannerMenu ? onBannerContextMenu : undefined,
	};
}
