// SPDX-License-Identifier: AGPL-3.0-or-later

import {createPersonaID, type PersonaID, type UserID} from '@app/api/BrandedTypes';
import {currentActivityMeta} from '@app/api/infrastructure/activity/ActivityMeta';
import {Logger} from '@app/api/Logger';
import type {Persona} from '@app/api/models/Persona';
import {PersonaNotFoundError} from '@app/api/persona/errors/PersonaErrors';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';
import type {LegacyMessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

/** The part of a message, edit or typing request that says which persona it is for. */
interface PersonaNamingRequest {
	persona_id?: bigint | string | null;
	subprofile?: LegacyMessageSubprofileRequest | null;
}

const LEGACY_LOG_INTERVAL_MS = 60 * 60 * 1000;
const LEGACY_LOG_MAX_USERS = 10_000;
const legacyLoggedAt = new Map<string, number>();

/**
 * Says once an hour per account that it still has a client sending the old `subprofile` object,
 * with that client's user agent. The deprecated input can go when this stops appearing.
 */
function noteLegacyPersonaNaming(userId: UserID): void {
	const key = userId.toString();
	const now = Date.now();
	const last = legacyLoggedAt.get(key);
	if (last !== undefined && now - last < LEGACY_LOG_INTERVAL_MS) return;
	if (legacyLoggedAt.size >= LEGACY_LOG_MAX_USERS) legacyLoggedAt.clear();
	legacyLoggedAt.set(key, now);
	void currentActivityMeta()
		.then((meta) => {
			Logger.info(
				{userId: key, userAgent: meta.ua, releaseChannel: meta.channel},
				'Persona named with the deprecated subprofile object instead of persona_id',
			);
		})
		.catch(() => {});
}

/**
 * Which persona a request names: its id, `null` for the account itself, or `undefined` when the
 * request says nothing. `persona_id` is the way to say it. The `subprofile` object is what older
 * clients send, and is read only when `persona_id` is absent.
 */
export function requestedPersonaId(
	request: PersonaNamingRequest | null | undefined,
	userId: UserID,
): string | null | undefined {
	if (!request) return undefined;
	if (request.persona_id !== undefined) {
		return request.persona_id === null ? null : request.persona_id.toString();
	}
	if (request.subprofile === undefined) return undefined;
	noteLegacyPersonaNaming(userId);
	return request.subprofile === null ? null : request.subprofile.id;
}

/** The persona, if the account owns it and it has not been deleted. Anything else is "not found". */
export async function resolveOwnedPersona(
	personaRepository: IPersonaRepository,
	userId: UserID,
	rawPersonaId: string,
): Promise<Persona> {
	if (!/^\d+$/.test(rawPersonaId)) {
		throw new PersonaNotFoundError();
	}
	const persona = await personaRepository.findById(userId, createPersonaID(BigInt(rawPersonaId)));
	if (!persona || persona.isDeleted) {
		throw new PersonaNotFoundError();
	}
	return persona;
}

export async function resolveOwnedPersonaId(
	personaRepository: IPersonaRepository,
	userId: UserID,
	rawPersonaId: string,
): Promise<PersonaID> {
	return (await resolveOwnedPersona(personaRepository, userId, rawPersonaId)).id;
}
