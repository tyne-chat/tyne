// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import {
	clearPersonaMentionCache,
	invalidatePersonaMentionCache,
} from '@app/features/lexical/composer/useAutocompletePersonaSearch';
import Messages from '@app/features/messaging/state/MessagingMessages';
import type {PersonaResponse, PersonaSettingsResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {PersonaStore} from '../state/PersonaStore';

type PersonaPayload = {persona: PersonaResponse} | PersonaResponse;
type PersonaDeletePayload = {persona_id: string} | {id: string};
type PersonasPayload = {personas: Array<PersonaResponse>} | Array<PersonaResponse>;

export function handleUserPersonaCreate(data: PersonaPayload, _context: GatewayHandlerContext): void {
	const persona = data && 'persona' in data && data.persona ? data.persona : (data as PersonaResponse);
	if (persona?.id) {
		PersonaStore.upsertPersona(persona);
		clearPersonaMentionCache();
	}
}

export function handleUserPersonaUpdate(data: PersonaPayload, _context: GatewayHandlerContext): void {
	const persona = data && 'persona' in data && data.persona ? data.persona : (data as PersonaResponse);
	if (persona?.id) {
		PersonaStore.upsertPersona(persona);
		clearPersonaMentionCache();
		Messages.handlePersonaUpdate({persona});
	}
}

export function handleUserPersonaDelete(data: PersonaDeletePayload, _context: GatewayHandlerContext): void {
	const id = (data as any)?.persona_id ?? (data as any)?.id;
	if (id) {
		PersonaStore.removePersona(id);
		clearPersonaMentionCache();
	}
}

export function handleUserPersonasUpdate(data: PersonasPayload, _context: GatewayHandlerContext): void {
	const personas = Array.isArray(data)
		? data
		: data && Array.isArray((data as any).personas)
			? (data as any).personas
			: null;
	if (personas) {
		PersonaStore.setPersonas(personas);
		clearPersonaMentionCache();
	}
}

export function handleUserPersonaSettingsUpdate(
	data: PersonaSettingsResponse | {settings: PersonaSettingsResponse},
	_context: GatewayHandlerContext,
): void {
	const settings = data && 'settings' in data && data.settings ? data.settings : (data as PersonaSettingsResponse);
	if (settings) {
		PersonaStore.updateSettings(settings);
		clearPersonaMentionCache();
	}
}

export function handleGuildPersonasDirty(
	data:
		| {
				guild_id?: string;
				user_id?: string;
				persona?: any;
				action?: 'update' | 'delete' | 'sync';
		  }
		| undefined,
	_context: GatewayHandlerContext,
): void {
	invalidatePersonaMentionCache(data?.guild_id);
	if (data?.persona && data?.action === 'update') {
		Messages.handlePersonaUpdate({persona: data.persona});
	}
}
