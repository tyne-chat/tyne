// SPDX-License-Identifier: AGPL-3.0-or-later

import {Db} from '@app/api/database/CassandraTypes';
import type {ChannelStateRow} from '@app/api/database/types/MessageTypes';

// Fork: a channel's `created_bucket` is the oldest bucket that the API's reads of its history start
// from (search indexing, purges, the message lists here). Upstream writes the channel's own bucket on
// every message write, which undoes a lower value set for history older than the channel, such as
// imported messages (tyne-chat/tyne#653). These keep it to the write that creates the channel's state
// row; a reader falls back to the channel's own bucket when the row has none.

export function withoutCreatedBucket<T extends {created_bucket: number}>(columns: T): Omit<T, 'created_bucket'> {
	const {created_bucket: _createdBucket, ...rest} = columns;
	return rest;
}

export function createdBucketForNewState(state: ChannelStateRow | null, createdBucket: number) {
	return state === null ? {created_bucket: Db.set(createdBucket)} : {};
}
