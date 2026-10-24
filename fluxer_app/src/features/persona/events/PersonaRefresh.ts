// SPDX-License-Identifier: AGPL-3.0-or-later

import MessageReactions from '@app/features/messaging/state/MessageReactions';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {AccountScopedWork} from '@app/features/platform/state/AccountScopedWork';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {PersonaStore} from '../state/PersonaStore';

/**
 * How long to collect "this account changed its personas" events before fetching. One edit arrives
 * once per community the two accounts share, plus once for direct messages, all at the same moment.
 */
export const PERSONA_REFRESH_DELAY_MS = 1000;

const pendingUserIds = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Shows a persona's new name, avatar and tag on the loaded messages and reactions that show it. */
export function applyPersonaUpdate(persona: MessageSubprofileResponse): void {
	Messages.handlePersonaUpdate({persona});
	MessageReactions.handlePersonaUpdate(persona);
}

/**
 * Fork: another account changed its personas without saying which (the server never names a private
 * persona in an event). Shortly after, the personas of that account this client shows are fetched
 * again, in one request for all accounts collected, and nothing is fetched if it shows none.
 */
export function requestPersonaRefresh(userId: string): void {
	pendingUserIds.add(userId);
	timer ??= setTimeout(() => void flushPersonaRefresh(), PERSONA_REFRESH_DELAY_MS);
}

async function flushPersonaRefresh(): Promise<void> {
	timer = null;
	const userIds = Array.from(pendingUserIds);
	pendingUserIds.clear();
	const pairs: Array<{userId: string; personaId: string}> = [];
	for (const userId of userIds) {
		const personaIds = new Set([
			...Messages.getPersonaIdsByAuthor(userId),
			...PersonaStore.getKnownPersonaIdsOf(userId),
		]);
		for (const personaId of personaIds) pairs.push({userId, personaId});
	}
	if (pairs.length === 0) return;
	const found = await PersonaStore.refreshPersonas(pairs);
	for (const persona of found) applyPersonaUpdate(persona);
}

AccountScopedWork.registerCancellation(() => {
	if (timer) clearTimeout(timer);
	timer = null;
	pendingUserIds.clear();
});
