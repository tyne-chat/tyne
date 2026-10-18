// SPDX-License-Identifier: AGPL-3.0-or-later

import {getTableMetadata} from '@app/api/database/CassandraMetaRegistry';
import {keyFromColumns} from '@app/api/database/PostgresKvQueryExecutor';
import {MessageReactions} from '@app/api/Tables';
import {describe, expect, it} from 'vitest';

// Fork: a reaction's persona is the 7th column of message_reactions' key (tyne-chat/tyne#135). The
// Postgres store keeps a row under its key columns' values joined in key order, so the position is
// part of every stored reaction: if a rebase puts an upstream key column before persona_id, or
// drops it, the code still compiles while reads, upserts and deletes miss the stored rows (reactions
// duplicate and cannot be removed). Keep persona_id 7th; upstream's new key columns go after it,
// with a migration that appends their value to the stored keys
// (scripts/migrate_message_reactions_persona_id.sql and its .ts twin in fluxer_api/scripts/ have
// the shape).
const STORED_KEY = ['channel_id', 'bucket', 'message_id', 'emoji_id', 'emoji_name', 'user_id', 'persona_id'];

describe('message_reactions key layout', () => {
	it('keeps the key columns in the order stored rows were written in', () => {
		expect(MessageReactions).toBeDefined();
		const table = getTableMetadata('message_reactions');
		expect(table?.primaryKey).toEqual(STORED_KEY);
		expect(table?.partitionKey).toEqual(['channel_id', 'bucket']);
	});

	it('writes the persona as the 7th part of a stored key', () => {
		const key = keyFromColumns(STORED_KEY, {
			channel_id: 1n,
			bucket: 2,
			message_id: 3n,
			emoji_id: 0n,
			emoji_name: 'wave',
			user_id: 4n,
			persona_id: 5n,
		});
		const parts = key.split('\u001f');
		expect(parts).toHaveLength(7);
		expect(parts[6]).toBe(keyFromColumns(['persona_id'], {persona_id: 5n}));
	});
});
