// SPDX-License-Identifier: AGPL-3.0-or-later

import {getNotificationIconURL} from '@app/features/notification/utils/NotificationIconURL';
import type {PersonaAvatarSource} from '@app/features/persona/utils/PersonaAvatarUrls';
import type {User} from '@app/features/user/models/User';
import {isPersonaAssetHash} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';

/**
 * Fork: the notification icon for a message sent as a persona. A persona's avatar is a media hash
 * stored under the owning account, so it goes through upstream's `getNotificationIconURL` in place
 * of the account's own, which gives the format each platform needs (PNG for the desktop app's
 * native notifications). The guild is left out so a server avatar does not cover the persona's.
 *
 * No persona, or a persona without an avatar of its own, gives the account's icon, as upstream;
 * so does a value that is not a persona image hash, which is never put into an image address.
 */
export function getPersonaNotificationIconURL(
	user: Pick<User, 'id' | 'avatar'>,
	guildId: string | null | undefined,
	persona: PersonaAvatarSource | null | undefined,
): string {
	const avatarHash = persona?.avatar;
	if (!isPersonaAssetHash(avatarHash)) return getNotificationIconURL(user, guildId);
	return getNotificationIconURL({id: user.id, avatar: avatarHash});
}
