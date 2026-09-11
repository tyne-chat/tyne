// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {PersonaStore} from '../state/PersonaStore';

export function handleUserPersonaCreate(data: PersonaResponse, _context: GatewayHandlerContext): void {
	PersonaStore.upsertPersona(data);
}

export function handleUserPersonaUpdate(data: PersonaResponse, _context: GatewayHandlerContext): void {
	PersonaStore.upsertPersona(data);
}

export function handleUserPersonaDelete(data: {id: string}, _context: GatewayHandlerContext): void {
	PersonaStore.removePersona(data.id);
}

export function handleUserPersonasUpdate(data: Array<PersonaResponse>, _context: GatewayHandlerContext): void {
	PersonaStore.setPersonas(data);
}
