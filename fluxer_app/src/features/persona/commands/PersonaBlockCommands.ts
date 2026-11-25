// SPDX-License-Identifier: AGPL-3.0-or-later

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import MessagingMessages from '@app/features/messaging/state/MessagingMessages';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import type {
	PersonaBlockListResponse,
	PersonaBlockResponse,
} from '@fluxer/schema/src/domains/persona/PersonaBlockSchemas';
import {PersonaBlocks} from '../state/PersonaBlocks';
import {sendPersonaRequest} from './PersonaCommands';

// The personas this account has blocked (tyne-chat/tyne#921). Every change also comes back as
// USER_PERSONA_BLOCKS_UPDATE, the whole list; the replies are applied at once so the messages
// collapse without waiting for it. A reply that arrives after the list was reset (account switch,
// sign-out, a READY with a new session) is dropped.

const logger = new Logger('PersonaBlockCommands');

let inFlight: {epoch: number; request: Promise<void>} | null = null;

/**
 * Takes a new list and re-marks the loaded messages: a message from a persona just blocked
 * collapses, one from a persona just unblocked comes back. Upstream's refresh after a block or
 * unblock of an account does the marking, with the persona's rule included (`isMessageAuthorBlocked`).
 */
export function applyPersonaBlocks(blocks: ReadonlyArray<PersonaBlockResponse>): void {
	PersonaBlocks.setBlocks(blocks);
	MessagingMessages.handleRelationshipUpdate();
}

/**
 * Loads the list after READY: one request per READY. Calls while one is on its way share it, unless
 * the list was reset since it started. A failure leaves the list as it is and is not retried here:
 * the next READY asks again.
 */
export function fetchPersonaBlocks(): Promise<void> {
	const epoch = PersonaBlocks.epoch;
	if (inFlight && inFlight.epoch === epoch) return inFlight.request;
	const entry: {epoch: number; request: Promise<void>} = {epoch, request: Promise.resolve()};
	entry.request = (async () => {
		try {
			const res = await http.get<PersonaBlockListResponse>(ForkEndpoints.USER_PERSONA_BLOCKS);
			if (PersonaBlocks.epoch !== epoch) return;
			if (res.ok && Array.isArray(res.body)) applyPersonaBlocks(res.body);
			else logger.warn(`Failed to fetch blocked personas: status ${res.status}`);
		} catch (err) {
			logger.error('Error fetching blocked personas', err);
		} finally {
			if (inFlight === entry) inFlight = null;
		}
	})();
	inFlight = entry;
	return entry.request;
}

export async function blockPersona(userId: string, personaId: string): Promise<void> {
	const epoch = PersonaBlocks.epoch;
	const res = await sendPersonaRequest(
		() => http.put<PersonaBlockListResponse>(ForkEndpoints.USER_PERSONA_BLOCK(userId, personaId)),
		'Failed to block the persona',
	);
	if (PersonaBlocks.epoch === epoch) applyPersonaBlocks(res.body);
}

export async function unblockPersona(userId: string, personaId: string): Promise<void> {
	const epoch = PersonaBlocks.epoch;
	const res = await sendPersonaRequest(
		() => http.delete<PersonaBlockListResponse>(ForkEndpoints.USER_PERSONA_BLOCK(userId, personaId)),
		'Failed to unblock the persona',
	);
	if (PersonaBlocks.epoch === epoch) applyPersonaBlocks(res.body);
}
