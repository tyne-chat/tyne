// SPDX-License-Identifier: AGPL-3.0-or-later

import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {isPersonaAssetHash} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';

const TAG_ICON_SIZE = 32;

/**
 * Fork: the one place where an account's display tag icon becomes an image address, as
 * `personaAvatarUrls` is for a persona's avatar.
 *
 * The icon is the hash of an image stored under the owning account, served through the media
 * proxy like the account's avatar, with an animated variant for hover. Anything else gives no
 * image: a link would make the app load a picture from a server the account's owner chose, and
 * tell that server who is reading. The server sends only hashes; this holds for values cached or
 * sent before it did. Without the owner's id there is no address either.
 */
export function personaTagIconUrls(
	ownerUserId: string | null | undefined,
	icon: string | null | undefined,
): {staticUrl: string; hoverUrl: string} | null {
	const hash = icon?.trim();
	if (!ownerUserId || !isPersonaAssetHash(hash)) return null;
	return {
		staticUrl: AvatarUtils.getUserAvatarURL({id: ownerUserId, avatar: hash}, false, TAG_ICON_SIZE),
		hoverUrl: AvatarUtils.getUserAvatarURL({id: ownerUserId, avatar: hash}, true, TAG_ICON_SIZE),
	};
}
