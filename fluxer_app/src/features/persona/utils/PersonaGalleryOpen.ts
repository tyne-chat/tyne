// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaGalleryNav} from '@app/features/persona/state/PersonaGalleryNav';
import {PersonaGallerySheetState} from '@app/features/persona/state/PersonaGallerySheetState';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import type {User} from '@app/features/user/models/User';

/**
 * Shows an account's personas (tyne-chat/tyne#189), and one of them when `personaId` is given: on
 * phones in the Personas sheet, elsewhere in the full profile's Personas tab, which this opens. A
 * full profile already open for the account switches to the tab.
 */
export function openPersonaGallery(
	user: User,
	{
		guildId,
		personaId = null,
		profileOpen = false,
	}: {guildId?: string; personaId?: string | null; profileOpen?: boolean} = {},
): void {
	PersonaGalleryNav.request(user.id, personaId);
	if (MobileLayout.enabled) {
		PersonaGallerySheetState.open(user);
		return;
	}
	if (profileOpen) return;
	// A profile that cannot open now must not jump to its Personas tab the next time it does.
	if (!UserProfileCommands.openUserProfile(user.id, guildId)) {
		PersonaGalleryNav.takeTabRequest(user.id);
		PersonaGalleryNav.takePersonaRequest(user.id);
	}
}
