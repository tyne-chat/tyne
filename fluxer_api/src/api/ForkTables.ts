// SPDX-License-Identifier: AGPL-3.0-or-later

import {defineTable} from '@app/api/database/CassandraTableDsl';
import {PERSONA_COLUMNS, type PersonaRow} from '@app/api/database/types/PersonaTypes';

// Fork: the fork's tables. Tables.ts re-exports them, so code imports them from there, as it does
// upstream's.

export const Personas = defineTable<PersonaRow, 'user_id' | 'persona_id', 'user_id'>({
	name: 'personas',
	columns: PERSONA_COLUMNS,
	primaryKey: ['user_id', 'persona_id'],
	partitionKey: ['user_id'],
});
