// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {useEffect} from 'react';

function findOnLoadedMessages(
	channelIds: ReadonlyArray<string | null | undefined>,
	ownerId: string,
	personaId: string,
): MessageSubprofileResponse | null {
	for (const channelId of channelIds) {
		if (!channelId) continue;
		let found: MessageSubprofileResponse | null = null;
		Messages.getCachedMessages(channelId)?.forEach((message) => {
			if (found === null && message.author.id === ownerId && message.subprofile?.id === personaId) {
				found = message.subprofile;
			}
		});
		if (found !== null) return found;
	}
	return null;
}

/**
 * The persona a thread was started as. Null when it was started as the account, and while the
 * persona cannot be named yet, so callers fall back to the account's name.
 *
 * A thread carries only the persona's ID. The name comes from what this client already knows: the
 * user's own personas, personas seen before, and messages the owner sent as it in the thread or
 * its parent (which is how a private persona gets its name). Failing that it is looked up once.
 * Call from an observer component.
 */
export function useThreadOwnerPersona(thread: Channel | null | undefined): MessageSubprofileResponse | null {
	const ownerId = thread?.ownerId ?? null;
	const personaId = thread?.ownerPersonaId ?? null;
	const known = personaId ? PersonaStore.getKnownPersona(personaId) : null;
	const unresolved = ownerId !== null && personaId !== null && known === null;
	// Subscribes to loaded messages only while unresolved, so messages arriving later name the persona.
	if (unresolved) void Messages.version;
	const onMessages = unresolved ? findOnLoadedMessages([thread?.id, thread?.parentId], ownerId, personaId) : null;
	useEffect(() => {
		if (!unresolved) return;
		if (onMessages) {
			PersonaStore.recordKnownPersona(onMessages);
			return;
		}
		void PersonaStore.fetchPersona(ownerId, personaId);
	}, [unresolved, onMessages, ownerId, personaId]);
	return known ?? onMessages;
}
