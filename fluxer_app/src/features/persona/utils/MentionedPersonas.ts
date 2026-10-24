// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {PersonaStore} from '../state/PersonaStore';

/** A persona mention in message text: `<@userId:personaId>`. */
const PERSONA_MENTION = /<@!?(\d+):(\d+)>/g;

/**
 * Fork: remembers the personas a message mentions, each with its owner, read from the mention in
 * the text (the message's `mention_personas` do not name their owners).
 */
export function rememberMentionedPersonas(
	content: string | null | undefined,
	personas: ReadonlyArray<MessageSubprofileResponse> | null | undefined,
): void {
	if (!personas || personas.length === 0) return;
	const owners = new Map<string, string>();
	for (const match of (content ?? '').matchAll(PERSONA_MENTION)) owners.set(match[2], match[1]);
	for (const persona of personas) PersonaStore.recordKnownPersona(persona, owners.get(persona.id));
}
