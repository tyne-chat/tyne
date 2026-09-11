// SPDX-License-Identifier: AGPL-3.0-or-later

import {singleton} from '@app/api/middleware/Singleton';
import {PersonaRepository} from '@app/api/persona/PersonaRepository';

// Fork: the fork's service singletons, beside upstream's ServiceSingletons.ts.
export const getPersonaRepository = singleton(() => new PersonaRepository());
