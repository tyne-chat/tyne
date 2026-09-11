// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import type {
	PersonaCreateRequest,
	PersonaResponse,
	PersonaUpdateRequest,
	PublicPersonaResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {PersonaStore} from '../state/PersonaStore';

const logger = new Logger('PersonaCommands');

const publicPersonaCache = new Map<string, {data: PublicPersonaResponse; expiresAt: number}>();
const PUBLIC_PERSONA_TTL_MS = 60 * 1000;

export async function fetchPersonas(): Promise<Array<PersonaResponse>> {
	try {
		const res = await http.get<Array<PersonaResponse>>(Endpoints.USER_PERSONAS);
		if (res.ok && Array.isArray(res.body)) {
			PersonaStore.setPersonas(res.body);
			return res.body;
		}
		logger.warn(`Failed to fetch personas: status ${res.status}`);
		return [];
	} catch (err) {
		logger.error('Error fetching personas', err);
		return [];
	}
}

export async function createPersona(data: PersonaCreateRequest): Promise<PersonaResponse> {
	const res = await http.post<PersonaResponse>(Endpoints.USER_PERSONAS, {
		body: data,
	});
	if (!res.ok || !res.body) {
		throw new Error(`Failed to create persona: status ${res.status}`);
	}
	PersonaStore.upsertPersona(res.body);
	return res.body;
}

export async function updatePersona(id: string, data: PersonaUpdateRequest): Promise<PersonaResponse> {
	const res = await http.patch<PersonaResponse>(Endpoints.USER_PERSONA(id), {
		body: data,
	});
	if (!res.ok || !res.body) {
		throw new Error(`Failed to update persona: status ${res.status}`);
	}
	PersonaStore.upsertPersona(res.body);
	// Invalidate any cached public representation of this persona
	for (const key of publicPersonaCache.keys()) {
		if (key.endsWith(`:${id}`)) {
			publicPersonaCache.delete(key);
		}
	}
	return res.body;
}

export async function deletePersona(id: string): Promise<void> {
	const res = await http.delete(Endpoints.USER_PERSONA(id));
	if (!res.ok && res.status !== 404) {
		throw new Error(`Failed to delete persona: status ${res.status}`);
	}
	PersonaStore.removePersona(id);
	for (const key of publicPersonaCache.keys()) {
		if (key.endsWith(`:${id}`)) {
			publicPersonaCache.delete(key);
		}
	}
}

export async function importPersonas(personas: Array<PersonaCreateRequest>): Promise<Array<PersonaResponse>> {
	const res = await http.post<Array<PersonaResponse>>(Endpoints.USER_PERSONA_IMPORT, {
		body: personas,
	});
	if (!res.ok || !res.body) {
		throw new Error(`Failed to import personas: status ${res.status}`);
	}
	PersonaStore.upsertPersonas(res.body);
	return res.body;
}

export async function fetchPublicPersona(userId: string, personaId: string): Promise<PublicPersonaResponse | null> {
	const cacheKey = `${userId}:${personaId}`;
	const cached = publicPersonaCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.data;
	}

	try {
		const res = await http.get<PublicPersonaResponse>(Endpoints.USER_PUBLIC_PERSONA(userId, personaId));
		if (res.ok && res.body) {
			publicPersonaCache.set(cacheKey, {
				data: res.body,
				expiresAt: Date.now() + PUBLIC_PERSONA_TTL_MS,
			});
			return res.body;
		}
		return null;
	} catch (err) {
		logger.warn(`Failed to fetch public persona ${personaId} for user ${userId}`, err);
		return null;
	}
}
