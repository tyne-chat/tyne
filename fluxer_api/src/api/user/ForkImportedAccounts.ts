// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: placeholder accounts the Discord history import makes for people not on Tyne (UserFlags.IMPORTED,
// tyne-chat/tyne#682). They only hold imported messages: anyone signed in may see their profile (they share
// no community with anyone), and nobody can open a DM with them, write in one or befriend them.

import type {UserID} from '@app/api/BrandedTypes';
import type {User} from '@app/api/models/User';
import {UserFlags} from '@fluxer/constants/src/UserConstants';
import {CannotSendMessagesToUserError} from '@fluxer/errors/src/domains/channel/CannotSendMessagesToUserError';

export function isImportedPlaceholder(user: Pick<User, 'flags'> | null | undefined): boolean {
	return user != null && (user.flags & UserFlags.IMPORTED) !== 0n;
}

/** Refuses a DM with a placeholder, as with anyone who cannot be messaged. */
export async function assertNotImportedPlaceholder(
	users: {findUnique(userId: UserID): Promise<User | null>},
	userId: UserID,
): Promise<void> {
	if (isImportedPlaceholder(await users.findUnique(userId))) throw new CannotSendMessagesToUserError();
}
