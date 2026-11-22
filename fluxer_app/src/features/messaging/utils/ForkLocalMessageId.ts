// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork (tyne-chat/tyne#701): the id of a message the client puts in its store before the server
// has one, or without the server: a send's nonce, which is also its pending copy's id, and a local
// system notice's id.
//
// Upstream builds these with `fromTimestamp(Date.now())`: worker 0, sequence 0. The server's
// message ids on a single-shard instance have that shape too, so a local id equals the id of any
// message the server created in the same millisecond of the client's clock. With the client's
// clock a little behind the server's, a send could take the id of the author's own previous
// message: the pending copy overwrote it on the sender's screen, and the server's copy replaced it
// on every other screen, until a reload.
//
// Here the worker bits are random and never 0, and the sequence bits are random, so a local id
// cannot equal a worker-0 server id, and matching an id from another worker would need the same
// millisecond, worker and sequence. The timestamp bits are the clock's, so local messages still
// sort where upstream's did.

import {createSnowflake, MAX_SEQUENCE, MAX_WORKER_ID} from '@fluxer/snowflake/src/Snowflake';

export function newLocalMessageId(now: number = Date.now(), random: () => number = Math.random): string {
	const workerId = 1 + Math.floor(random() * Number(MAX_WORKER_ID));
	const sequence = Math.floor(random() * (Number(MAX_SEQUENCE) + 1));
	return createSnowflake({timestamp: now, workerId, sequence}).toString();
}
