// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {PersonaResponse, PersonaSettingsResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {PersonaStore} from '../state/PersonaStore';

type PersonaPayload = {persona: PersonaResponse} | PersonaResponse;
type PersonaDeletePayload = {persona_id: string} | {id: string};
type PersonasPayload = {personas: Array<PersonaResponse>} | Array<PersonaResponse>;

export function handleUserPersonaCreate(data: PersonaPayload, _context: GatewayHandlerContext): void {
	const persona = data && 'persona' in data && data.persona ? data.persona : (data as PersonaResponse);
	if (persona?.id) {
		PersonaStore.upsertPersona(persona);
	}
}

export function handleUserPersonaUpdate(data: PersonaPayload, _context: GatewayHandlerContext): void {
	const persona = data && 'persona' in data && data.persona ? data.persona : (data as PersonaResponse);
	if (persona?.id) {
		PersonaStore.upsertPersona(persona);
	}
}

export function handleUserPersonaDelete(data: PersonaDeletePayload, _context: GatewayHandlerContext): void {
	const id = (data as any)?.persona_id ?? (data as any)?.id;
	if (id) {
		PersonaStore.removePersona(id);
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
	}
}

export function handleUserPersonaSettingsUpdate(
	data: PersonaSettingsResponse | {settings: PersonaSettingsResponse},
	_context: GatewayHandlerContext,
): void {
	const settings = data && 'settings' in data && data.settings ? data.settings : (data as PersonaSettingsResponse);
	if (settings) {
		PersonaStore.updateSettings(settings);
	}
}
