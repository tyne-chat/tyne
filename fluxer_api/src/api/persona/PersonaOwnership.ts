// SPDX-License-Identifier: AGPL-3.0-or-later

import {createPersonaID, type PersonaID, type UserID} from '@app/api/BrandedTypes';
import {PersonaNotFoundError} from '@app/api/persona/errors/PersonaErrors';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';

export async function resolveOwnedPersonaId(
	personaRepository: IPersonaRepository,
	userId: UserID,
	rawPersonaId: string,
): Promise<PersonaID> {
	if (!/^\d+$/.test(rawPersonaId)) {
		throw new PersonaNotFoundError();
	}
	const personaId = createPersonaID(BigInt(rawPersonaId));
	const persona = await personaRepository.findById(userId, personaId);
	if (!persona || persona.isDeleted) {
		throw new PersonaNotFoundError();
	}
	return personaId;
}
