// SPDX-License-Identifier: AGPL-3.0-or-later

import type {UserID} from '@app/api/BrandedTypes';
import {getPersonaRepository} from '@app/api/middleware/ServiceSingletons';
import {resolveOwnedPersona} from '@app/api/persona/PersonaOwnership';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

/**
 * What a typing indicator shows for the persona a request names, read from the account's own
 * records: the request supplies the id and nothing else. `undefined` when it names no persona.
 * A persona the account does not own, or has deleted, is refused, so that nobody is shown typing
 * as the account when they meant a persona.
 */
export async function resolveTypingSubprofile(
	userId: UserID,
	personaId: string | null | undefined,
): Promise<MessageSubprofileResponse | undefined> {
	if (personaId == null) return undefined;
	const personaRepository = getPersonaRepository();
	const [persona, settings] = await Promise.all([
		resolveOwnedPersona(personaRepository, userId, personaId),
		personaRepository.findSettings(userId),
	]);
	return persona.toSubprofileResponse(settings);
}
