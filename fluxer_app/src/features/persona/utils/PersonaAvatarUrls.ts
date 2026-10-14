// SPDX-License-Identifier: AGPL-3.0-or-later

import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import type {MediaProxyImageSize} from '@fluxer/constants/src/MediaProxyImageSizes';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

/** What a persona avatar needs: the persona's display copy, whose `avatar` is a media hash. */
export type PersonaAvatarSource = Pick<MessageSubprofileResponse, 'avatar'>;

/**
 * Fork: the one place where a persona's avatar becomes the image addresses upstream's `<Avatar>`
 * takes in `avatarUrl` and `hoverAvatarUrl`, which it uses as given.
 *
 * Use `<PersonaAvatar persona={…}>` in fork components; where an upstream file renders the avatar,
 * spread this into its `<Avatar>`. Never pass a persona's hash to `<Avatar>` directly:
 * `PersonaAvatarUsage.test.ts` checks for it.
 *
 * No persona, or a persona without an avatar of its own, gives no override, so `<Avatar>` shows
 * the account's avatar (a persona inherits it). Otherwise the persona's avatar is served through
 * the media proxy under the owning account, with an animated variant for hover.
 */
export function personaAvatarUrls(
	ownerUserId: string,
	persona: PersonaAvatarSource | null | undefined,
	mediaSize?: MediaProxyImageSize,
): {avatarUrl?: string; hoverAvatarUrl?: string} {
	const avatarHash = persona?.avatar;
	if (!avatarHash) return {};
	return {
		avatarUrl: AvatarUtils.getUserAvatarURL({id: ownerUserId, avatar: avatarHash}, false, mediaSize),
		hoverAvatarUrl: AvatarUtils.getUserAvatarURL({id: ownerUserId, avatar: avatarHash}, true, mediaSize),
	};
}
