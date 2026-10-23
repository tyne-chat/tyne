// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import MessageReactions from '@app/features/messaging/state/MessageReactions';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {AccountScopedWork} from '@app/features/platform/state/AccountScopedWork';
import {http} from '@app/features/platform/transport/RestTransport';
import {HttpError} from '@app/features/platform/types/EndpointError';
import type {RestResponse} from '@app/features/platform/types/TransportTypes';
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

function bodyString(body: unknown, key: 'message' | 'code'): string | null {
	if (body && typeof body === 'object' && key in body) {
		const value = (body as Record<string, unknown>)[key];
		if (typeof value === 'string' && value) return value;
	}
	return null;
}

/**
 * A persona request the server refused. `serverMessage` is the server's explanation, when it gave
 * one, for showing to the user; `message` adds the status for logs.
 */
export class PersonaRequestError extends Error {
	readonly status: number;
	readonly code: string | null;
	readonly serverMessage: string | null;

	constructor(reply: {status: number; body: unknown}, fallback: string) {
		const serverMessage = bodyString(reply.body, 'message');
		super(serverMessage ?? `${fallback}: status ${reply.status}`);
		this.name = 'PersonaRequestError';
		this.status = reply.status;
		this.code = bodyString(reply.body, 'code');
		this.serverMessage = serverMessage;
	}

	/** The server blocked the text; the app has already shown upstream's content-blocked dialog. */
	get isContentBlocked(): boolean {
		return this.status === 403 && this.code === APIErrorCodes.CONTENT_BLOCKED;
	}
}

/**
 * What to tell the user about a failed persona request: the server's message, otherwise `fallback`.
 * Null when the app has already shown a dialog for it (content blocked).
 */
export function personaErrorMessage(err: unknown, fallback: string): string | null {
	if (err instanceof PersonaRequestError) {
		return err.isContentBlocked ? null : (err.serverMessage ?? fallback);
	}
	return fallback;
}

/**
 * Sends a persona request and returns a reply with a body. The HTTP client throws `HttpError` for a
 * refused request, whose message is only the method and path; the server's message is in its body.
 */
async function sendPersonaRequest<T>(
	send: () => Promise<RestResponse<T>>,
	fallback: string,
): Promise<RestResponse<NonNullable<T>>> {
	let res: RestResponse<T>;
	try {
		res = await send();
	} catch (err) {
		if (err instanceof HttpError) throw new PersonaRequestError(err, fallback);
		throw err;
	}
	if (!res.ok || !res.body) throw new PersonaRequestError(res, fallback);
	return res as RestResponse<NonNullable<T>>;
}

export async function createPersona(data: PersonaCreateRequest): Promise<PersonaResponse> {
	const res = await sendPersonaRequest(
		() => http.post<PersonaResponse>(Endpoints.USER_PERSONAS, {body: data}),
		'Failed to create persona',
	);
	PersonaStore.upsertPersona(res.body);
	return res.body;
}

export async function updatePersona(id: string, data: PersonaUpdateRequest): Promise<PersonaResponse> {
	const res = await sendPersonaRequest(
		() => http.patch<PersonaResponse>(Endpoints.USER_PERSONA(id), {body: data}),
		'Failed to update persona',
	);
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
	// A persona that is already gone counts as deleted.
	let res: RestResponse;
	try {
		res = await http.delete(Endpoints.USER_PERSONA(id));
	} catch (err) {
		if (!(err instanceof HttpError)) throw err;
		if (err.status !== 404) throw new PersonaRequestError(err, 'Failed to delete persona');
		res = {ok: false, status: 404, headers: {}, body: null};
	}
	if (!res.ok && res.status !== 404) {
		throw new PersonaRequestError(res, 'Failed to delete persona');
	}
	PersonaStore.removePersona(id);
	for (const key of personaProfileCache.keys()) {
		if (key.endsWith(`:${id}`)) {
			personaProfileCache.delete(key);
		}
	}
}

export async function importPersonas(personas: Array<PersonaImportItem>): Promise<Array<PersonaResponse>> {
	const res = await sendPersonaRequest(
		() => http.post<Array<PersonaResponse>>(Endpoints.USER_PERSONA_IMPORT, {body: personas}),
		'Failed to import personas',
	);
	PersonaStore.upsertPersonas(res.body);
	return res.body;
}

/** Downloads the zip of all personas the server builds (`pluralkit.json`, images, `tyne.json`, README). */
export async function exportPersonas(): Promise<{blob: Blob; fileName: string}> {
	const res = await sendPersonaRequest(
		() => http.get<Blob>(Endpoints.USER_PERSONA_EXPORT, {parse: 'binary'}),
		'Failed to export personas',
	);
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

/**
 * Stores an image picked in the persona editor and returns its hash (and, for an avatar, its colour).
 * The editor calls this on Save, as upstream's profile editor sends a picked image with the profile.
 */
export async function uploadPersonaImage(
	kind: 'avatar' | 'banner',
	image: string,
): Promise<{hash: string; avatarColor: number | null}> {
	if (kind === 'avatar') {
		const res = await sendPersonaRequest(
			() =>
				http.post<{avatar_hash?: string; avatar_color?: number | null}>(Endpoints.USER_PERSONA_AVATAR, {
					body: {avatar: image},
				}),
			'Failed to upload avatar',
		);
		if (!res.body.avatar_hash) throw new PersonaRequestError(res, 'Failed to upload avatar');
		return {hash: res.body.avatar_hash, avatarColor: res.body.avatar_color ?? null};
	}
	const res = await sendPersonaRequest(
		() => http.post<{banner_hash?: string}>(Endpoints.USER_PERSONA_BANNER, {body: {banner: image}}),
		'Failed to upload banner',
	);
	if (!res.body.banner_hash) throw new PersonaRequestError(res, 'Failed to upload banner');
	return {hash: res.body.banner_hash, avatarColor: null};
}

/** Stores an image read from a persona export being imported. Returns its hash. */
export async function importPersonaImage(
	kind: 'avatar' | 'banner',
	image: string,
): Promise<{hash: string; avatarColor: number | null}> {
	const res = await sendPersonaRequest(
		() =>
			http.post<{hash: string; avatar_color?: number | null}>(Endpoints.USER_PERSONA_IMPORT_IMAGE, {
				body: {kind, image},
			}),
		'Failed to store image',
	);
	if (!res.body.hash) {
		throw new PersonaRequestError(res, 'Failed to store image');
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
