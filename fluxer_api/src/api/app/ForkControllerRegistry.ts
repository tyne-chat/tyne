// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaController} from '@app/api/persona/PersonaController';
import type {HonoApp} from '@app/api/types/HonoEnv';

// Fork: the fork's controllers. ControllerRegistry.ts registers them with this one call, after
// upstream's, as it always has.
export function registerForkControllers(routes: HonoApp): void {
	PersonaController(routes);
}
