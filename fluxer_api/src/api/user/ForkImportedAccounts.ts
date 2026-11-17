// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: placeholder accounts the Discord history import makes for people not on Tyne (UserFlags.IMPORTED,
// tyne-chat/tyne#682). They only hold imported messages: anyone signed in may see their profile (they share
// no community with anyone), and nobody can open a new DM with them, write in one or befriend them. A DM
// the import made, with its history, can be opened again once closed (tyne-chat/tyne#696).

import type {UserID} from '@app/api/BrandedTypes';
import type {Channel} from '@app/api/models/Channel';
import type {User} from '@app/api/models/User';
import {UserFlags} from '@fluxer/constants/src/UserConstants';
import {CannotSendMessagesToUserError} from '@fluxer/errors/src/domains/channel/CannotSendMessagesToUserError';

export function isImportedPlaceholder(user: Pick<User, 'flags'> | null | undefined): boolean {
	return user != null && (user.flags & UserFlags.IMPORTED) !== 0n;
}

interface PlaceholderLookups {
	findUnique(userId: UserID): Promise<User | null>;
	findExistingDmState(user1Id: UserID, user2Id: UserID): Promise<Channel | null>;
}

/** A DM between the two that holds messages: there is no point in opening an empty one. */
async function dmWithHistory(users: PlaceholderLookups, userId: UserID, otherId: UserID): Promise<Channel | null> {
	const dm = await users.findExistingDmState(userId, otherId);
	return dm && dm.lastMessageId != null ? dm : null;
}

/** Your DM with a placeholder when it holds messages (the history the import wrote), or null. */
export async function importedConversation(
	users: PlaceholderLookups,
	userId: UserID,
	otherId: UserID,
): Promise<Channel | null> {
	if (!isImportedPlaceholder(await users.findUnique(otherId))) return null;
	return dmWithHistory(users, userId, otherId);
}

/**
 * Opening a DM with a placeholder only reopens its imported conversation; anything else is refused, as with
 * anyone who cannot be messaged. Null for anyone who is not a placeholder: their DM opens as usual.
 */
export async function reopenableImportedConversation(
	users: PlaceholderLookups,
	userId: UserID,
	recipientId: UserID,
): Promise<Channel | null> {
	if (!isImportedPlaceholder(await users.findUnique(recipientId))) return null;
	const dm = await dmWithHistory(users, userId, recipientId);
	if (!dm) throw new CannotSendMessagesToUserError();
	return dm;
}
