// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a member can start a thread as one of their personas (see persona/ThreadOwnerPersonaStore.ts
// for what is kept). This is the check made before the thread exists.

import type {PersonaID, UserID} from '@app/api/BrandedTypes';
import {getPersonaRepository} from '@app/api/middleware/ServiceSingletons';
import {resolveOwnedPersonaId} from '@app/api/persona/PersonaOwnership';

/** Throws unless the persona is one of the user's own. Null when the thread is started as the account. */
export async function resolveThreadOwnerPersonaId(
	userId: UserID,
	rawPersonaId: bigint | string | null | undefined,
): Promise<PersonaID | null> {
	if (rawPersonaId == null) return null;
	return resolveOwnedPersonaId(getPersonaRepository(), userId, rawPersonaId.toString());
}
