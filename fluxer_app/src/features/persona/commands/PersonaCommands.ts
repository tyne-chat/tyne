// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import MessageReactions from '@app/features/messaging/state/MessageReactions';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {AccountScopedWork} from '@app/features/platform/state/AccountScopedWork';
import {http} from '@app/features/platform/transport/RestTransport';
import {HttpError} from '@app/features/platform/types/EndpointError';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import type {
	PersonaCreateRequest,
	PersonaImportItem,
	PersonaResponse,
	PersonaSettingsResponse,
	PersonaUpdateRequest,
	PublicPersonaResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {normalizeSubprofile, PersonaStore} from '../state/PersonaStore';

const logger = new Logger('PersonaCommands');

/**
 * What asking for another account's persona profile came to. `private` is the owner keeping it to
 * themselves, which is worth telling the person who asked; `unavailable` is everything else that
 * stops it being shown (deleted, no access to the account, the request failed).
 */
export type PersonaProfileResult =
	| {status: 'ready'; profile: PublicPersonaResponse}
	| {status: 'private'}
	| {status: 'unavailable'};

const personaProfileCache = new Map<string, {result: PersonaProfileResult; expiresAt: number}>();
const PERSONA_PROFILE_TTL_MS = 60 * 1000;

// What one account was given for a profile is not the next account's to see.
AccountScopedWork.registerCancellation(() => personaProfileCache.clear());

export async function fetchPersonaSettings(): Promise<PersonaSettingsResponse | null> {
	try {
		const res = await http.get<PersonaSettingsResponse>(Endpoints.USER_PERSONA_SETTINGS);
		if (res.ok && res.body) {
			PersonaStore.updateSettings(res.body);
			return res.body;
		}
		return null;
	} catch (err) {
		logger.error('Error fetching persona settings', err);
		return null;
	}
}

let lastFetchTimestamp = 0;
const FETCH_COOLDOWN_MS = 2000;

export function resetFetchPersonasCooldown(): void {
	lastFetchTimestamp = 0;
}

AccountScopedWork.registerCancellation(() => resetFetchPersonasCooldown());

export async function fetchPersonas(force = false): Promise<Array<PersonaResponse>> {
	const now = Date.now();
	if (!force && now - lastFetchTimestamp < FETCH_COOLDOWN_MS && PersonaStore.personas.length > 0) {
		return PersonaStore.personas as unknown as Array<PersonaResponse>;
	}

	try {
		const res = await http.get<Array<PersonaResponse>>(Endpoints.USER_PERSONAS);
		if (res.ok && Array.isArray(res.body)) {
			PersonaStore.setPersonas(res.body);
			lastFetchTimestamp = Date.now();
			return res.body;
		}
		logger.warn(`Failed to fetch personas: status ${res.status}`);
		return [];
	} catch (err) {
		logger.error('Error fetching personas', err);
		return [];
	}
}

function extractErrorMessage(res: {status: number; body: unknown}, fallback: string): string {
	if (
		res.body &&
		typeof res.body === 'object' &&
		'message' in res.body &&
		typeof (res.body as {message: unknown}).message === 'string'
	) {
		return (res.body as {message: string}).message;
	}
	return `${fallback}: status ${res.status}`;
}

export async function createPersona(data: PersonaCreateRequest): Promise<PersonaResponse> {
	const res = await http.post<PersonaResponse>(Endpoints.USER_PERSONAS, {
		body: data,
	});
	if (!res.ok || !res.body) {
		throw new Error(extractErrorMessage(res, 'Failed to create persona'));
	}
	PersonaStore.upsertPersona(res.body);
	return res.body;
}

export async function updatePersona(id: string, data: PersonaUpdateRequest): Promise<PersonaResponse> {
	const res = await http.patch<PersonaResponse>(Endpoints.USER_PERSONA(id), {
		body: data,
	});
	if (!res.ok || !res.body) {
		throw new Error(extractErrorMessage(res, 'Failed to update persona'));
	}
	PersonaStore.upsertPersona(res.body);
	const subprofile = normalizeSubprofile(res.body);
	Messages.handlePersonaUpdate({persona: subprofile});
	MessageReactions.handlePersonaUpdate(subprofile);
	// Invalidate any cached public representation of this persona
	for (const key of personaProfileCache.keys()) {
		if (key.endsWith(`:${id}`)) {
			personaProfileCache.delete(key);
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
	for (const key of personaProfileCache.keys()) {
		if (key.endsWith(`:${id}`)) {
			personaProfileCache.delete(key);
		}
	}
}

export async function importPersonas(personas: Array<PersonaImportItem>): Promise<Array<PersonaResponse>> {
	const res = await http.post<Array<PersonaResponse>>(Endpoints.USER_PERSONA_IMPORT, {
		body: personas,
	});
	if (!res.ok || !res.body) {
		throw new Error(extractErrorMessage(res, 'Failed to import personas'));
	}
	PersonaStore.upsertPersonas(res.body);
	return res.body;
}

/** Downloads the zip of all personas the server builds (`pluralkit.json`, images, `tyne.json`, README). */
export async function exportPersonas(): Promise<{blob: Blob; fileName: string}> {
	const res = await http.get<Blob>(Endpoints.USER_PERSONA_EXPORT, {parse: 'binary'});
	if (!res.ok || !res.body) {
		throw new Error(extractErrorMessage(res, 'Failed to export personas'));
	}
	return {blob: res.body, fileName: exportFileName(res.headers['content-disposition'])};
}

function exportFileName(disposition: string | undefined): string {
	const encoded = disposition ? /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] : undefined;
	if (encoded) {
		try {
			return decodeURIComponent(encoded);
		} catch {}
	}
	return `Tyne personas ${new Date().toISOString().slice(0, 10)}.zip`;
}

/** Stores an image read from a persona export being imported. Returns its hash. */
export async function importPersonaImage(
	kind: 'avatar' | 'banner',
	image: string,
): Promise<{hash: string; avatarColor: number | null}> {
	const res = await http.post<{hash: string; avatar_color?: number | null}>(Endpoints.USER_PERSONA_IMPORT_IMAGE, {
		body: {kind, image},
	});
	if (!res.ok || !res.body?.hash) {
		throw new Error(extractErrorMessage(res, 'Failed to store image'));
	}
	return {hash: res.body.hash, avatarColor: res.body.avatar_color ?? null};
}

export async function fetchPersonaProfile(userId: string, personaId: string): Promise<PersonaProfileResult> {
	const cacheKey = `${userId}:${personaId}`;
	const cached = personaProfileCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.result;
	}

	let result: PersonaProfileResult = {status: 'unavailable'};
	try {
		const res = await http.get<PublicPersonaResponse>(Endpoints.USER_PUBLIC_PERSONA(userId, personaId));
		if (res.ok && res.body) {
			result = {status: 'ready', profile: res.body};
		} else if (isPrivatePersonaReply(res.status, res.body)) {
			result = {status: 'private'};
		}
	} catch (err) {
		if (err instanceof HttpError && isPrivatePersonaReply(err.status, err.body)) {
			result = {status: 'private'};
		} else {
			logger.warn(`Failed to fetch persona profile ${personaId} for user ${userId}`, err);
		}
	}
	// A failed request is asked again next time; an answer, private included, is good for a minute.
	if (result.status !== 'unavailable') {
		personaProfileCache.set(cacheKey, {result, expiresAt: Date.now() + PERSONA_PROFILE_TTL_MS});
	}
	return result;
}

function isPrivatePersonaReply(status: number, body: unknown): boolean {
	if (status !== 403) return false;
	return typeof body === 'object' && body !== null && (body as {code?: unknown}).code === APIErrorCodes.PRIVATE_PERSONA;
}
