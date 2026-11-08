// SPDX-License-Identifier: AGPL-3.0-or-later

import {personaColor} from '@app/features/persona/utils/PersonaColor';
import type {GalleryPersona} from '@app/features/persona/utils/PersonaGalleryItems';
import * as ColorUtils from '@app/features/theme/utils/ColorUtils';
import type {User} from '@app/features/user/models/User';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';

/** The persona's colour by the one rule (`personaColor`), as a CSS colour, or none. */
export function galleryPersonaColor(persona: GalleryPersona): string | undefined {
	const color = personaColor({color: persona.color, avatar_color: persona.avatarColor, avatar: persona.avatar});
	return color != null ? ColorUtils.int2hex(color) : undefined;
}

/** The persona's banner, or '' without one. */
export function galleryBannerUrl(user: User, persona: GalleryPersona, size: 480 | 1024 = 480): string {
	return AvatarUtils.getPersonaBannerURL({userId: user.id, banner: persona.banner}, false, size);
}
