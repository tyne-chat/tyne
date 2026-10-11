// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ClientPersona, PersonaStoreClass} from '@app/features/persona/state/PersonaStore';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';

let nextPersonaNumber = 1;

/**
 * For tests: puts a persona in a store the way one arrives from the server, with an id of the
 * server's kind and whatever fields the test names, and returns it as the store holds it.
 */
export function addTestPersona(
	store: PersonaStoreClass,
	fields: Partial<PersonaResponse> & {name: string},
): ClientPersona {
	const id = fields.id ?? (1540000000000000000n + BigInt(nextPersonaNumber++)).toString();
	const timestamp = '2026-01-01T00:00:00.000Z';
	store.upsertPersona({
		avatar_hash: null,
		banner_hash: null,
		pronouns: null,
		color: null,
		avatar_color: null,
		bio: null,
		auto_tag_disabled: false,
		persona_tags: [],
		signature_emojis: [],
		use_count: 0,
		last_used_at_ms: null,
		visibility: 'unlisted',
		external_uuid: null,
		created_at: timestamp,
		updated_at: timestamp,
		...fields,
		id,
	});
	const stored = store.getPersona(id);
	if (!stored) throw new Error(`Test persona ${id} was not stored`);
	return stored;
}
