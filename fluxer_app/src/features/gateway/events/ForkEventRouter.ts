// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerRegistry} from '@app/features/gateway/events/EventRouter';
import {
	handleUserPersonaCreate,
	handleUserPersonaDelete,
	handleUserPersonaSettingsUpdate,
	handleUserPersonasUpdate,
	handleUserPersonaUpdate,
} from '@app/features/persona/events/PersonaEvents';

type GatewayEventHandler = Parameters<GatewayHandlerRegistry['set']>[1];

// Fork: the fork's gateway events. EventRouter's createHandlerRegistry() registers them with this one
// call; they are looked up by name, and upstream sends none of them.
export function registerForkGatewayHandlers(registry: GatewayHandlerRegistry): void {
	registry.set('USER_PERSONA_CREATE', handleUserPersonaCreate as GatewayEventHandler);
	registry.set('USER_PERSONA_UPDATE', handleUserPersonaUpdate as GatewayEventHandler);
	registry.set('USER_PERSONA_DELETE', handleUserPersonaDelete as GatewayEventHandler);
	registry.set('USER_PERSONAS_UPDATE', handleUserPersonasUpdate as GatewayEventHandler);
	registry.set('USER_PERSONA_SETTINGS_UPDATE', handleUserPersonaSettingsUpdate as GatewayEventHandler);
}
