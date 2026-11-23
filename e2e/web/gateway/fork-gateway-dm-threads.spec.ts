// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: gateway contract T7 (tyne-chat/tyne#905): threads in DMs and group DMs (tyne-chat/tyne#699) as the
// gateway carries them.
//
// - The API sends every event about a DM thread to each person in the DM as FORK_DM_THREAD_EVENT {t, d, push}
//   (ForkDmThreads.ts), never as a plain event, so apps that predate DM threads drop it. The gateway passes the
//   envelope to the account's sessions as it is.
// - READY carries the fork's `fork_dm_threads` field, which the API builds and the gateway passes through.
// - A new thread message is pushed to each follower as a message in the parent DM (so older apps open the DM),
//   titled "Author (Thread)" in a 1:1 DM and "Author (Thread, Group)" in a named group DM (the API's
//   fork_thread_context), with fork_thread_id and fork_thread_name, and tags of the thread
//   (fluxer_gateway's fork/dm_thread_push.gleam). The job's channel and url stay the DM.
// - A follower with a session that is online and not AFK holds DM pushes back (upstream's presence push buffer,
//   keyed by the thread for a thread message: fork/dm_thread_presence.gleam); they are sent when every session is
//   AFK or offline. Reading the thread drops its held push; reading only the parent DM does not.
// - While the push service does not answer, jobs wait in the gateway's outbox (push/outbox) and a read truncates
//   them. A thread push is filed under the thread, so a read of the parent DM leaves it alone.
//
// The two "survives reading the parent DM" tests failed on the Erlang gateway, whose outbox filed a thread push
// under the parent DM (tyne-chat/tyne#907), and were marked fixme until the port to the Gleam gateway keyed it by
// the thread (tyne-chat/tyne#905).

import {expect, test} from '@playwright/test';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {type PushJob, PushSink} from '../../api-helpers/push-sink.js';
import {
	type Account,
	account,
	api,
	baseURL,
	befriend,
	community,
	stamp,
	THREAD_FEATURES,
	touchGateway,
} from './fork-gateway-support.js';

/** IDENTIFY flag of apps that know threads (CHANNEL_THREADS), as Tyne's apps send it. */
const CHANNEL_THREADS_FLAG = 0x4;
const PUBLIC_THREAD = 11;

interface DmThread {
	readonly dmId: string;
	readonly threadId: string;
	readonly threadName: string;
	/** The name of the group DM, or null for a 1:1 DM. */
	readonly groupName: string | null;
}

/** A 1:1 DM between `author` and `follower` (who share a community), with a thread the author started. */
async function dmWithThread(author: Account, follower: Account): Promise<DmThread> {
	await touchGateway(author);
	await community(author, [follower], 't7');
	const dm = await api(author.token, 'POST', '/users/@me/channels', {recipient_id: follower.id});
	return {dmId: dm.id, ...(await startThread(author, dm.id)), groupName: null};
}

/** A named group DM of `author` and `followers` (friends of the author), with a thread the author started. */
async function groupDmWithThread(author: Account, followers: ReadonlyArray<Account>): Promise<DmThread> {
	await touchGateway(author);
	for (const follower of followers) await befriend(author, follower);
	const group = await api(author.token, 'POST', '/users/@me/channels', {recipients: followers.map((f) => f.id)});
	const groupName = `GW group ${stamp()}`;
	await api(author.token, 'PATCH', `/channels/${group.id}`, {name: groupName});
	return {dmId: group.id, ...(await startThread(author, group.id)), groupName};
}

async function startThread(author: Account, dmId: string): Promise<{threadId: string; threadName: string}> {
	const threadName = `GW thread ${stamp()}`;
	const thread = await api(
		author.token,
		'POST',
		`/channels/${dmId}/threads`,
		{name: threadName, type: PUBLIC_THREAD},
		THREAD_FEATURES,
	);
	return {threadId: thread.id, threadName};
}

async function post(author: Account, channelId: string, content: string): Promise<{id: string}> {
	return api(author.token, 'POST', `/channels/${channelId}/messages`, {content}, THREAD_FEATURES);
}

async function ack(reader: Account, channelId: string, messageId: string): Promise<void> {
	await api(reader.token, 'POST', `/channels/${channelId}/messages/${messageId}/ack`, {}, THREAD_FEATURES);
}

/** The push job for `messageId` addressed to `userId`. */
function jobFor(userId: string, messageId: string): (job: PushJob) => boolean {
	return (job) =>
		job.subject === 'push.job.message' && job.body?.message_id === messageId && job.body?.user_ids?.includes(userId);
}

/** Checks a thread message's push: the title, the thread fields and tags, the DM as its channel. */
function expectThreadPush(job: PushJob, author: Account, thread: DmThread, messageId: string): void {
	const notification = job.body.notification;
	const context = thread.groupName ? `${thread.threadName}, ${thread.groupName}` : thread.threadName;
	expect(notification.title).toBe(`${author.name} (${context})`);
	expect(notification.fork_thread_id).toBe(thread.threadId);
	expect(notification.fork_thread_name).toBe(thread.threadName);
	expect(notification.tag).toBe(`channel:${thread.threadId}:${messageId}`);
	expect(notification.notification_tag).toBe(`channel:${thread.threadId}`);
	// Apps that predate DM threads open the parent DM.
	expect(job.body.channel_id).toBe(thread.dmId);
	expect(String(notification.url)).toContain(`/@me/${thread.dmId}/${messageId}`);
}

/** Sets a session AFK (op 3) and waits until the account's presence has taken it (SESSIONS_REPLACE). */
async function goAfk(session: GatewayRecorder): Promise<void> {
	const from = session.mark();
	session.send(3, {status: 'online', afk: true, since: Date.now(), activities: []});
	await session.waitFor(
		'SESSIONS_REPLACE',
		(d) => Array.isArray(d) && d.some((s: any) => s.session_id === session.sessionId && s.afk === true),
		{from},
	);
}

test.describe('gateway contract: threads in DMs (T7)', () => {
	for (const kind of ['1:1 DM', 'named group DM'] as const) {
		test(`in a ${kind}, the account's sessions get the thread message only as FORK_DM_THREAD_EVENT`, async () => {
			const author = await account('t7author');
			const follower = await account('t7follow');
			const thread =
				kind === '1:1 DM' ? await dmWithThread(author, follower) : await groupDmWithThread(author, [follower]);
			const authorSession = await GatewayRecorder.connect(baseURL, author.token, {flags: CHANNEL_THREADS_FLAG});
			const followerSessions = [
				await GatewayRecorder.connect(baseURL, follower.token, {flags: CHANNEL_THREADS_FLAG}),
				await GatewayRecorder.connect(baseURL, follower.token, {flags: CHANNEL_THREADS_FLAG}),
			];
			const sessions = [authorSession, ...followerSessions];
			try {
				// READY keeps the fork's field: DM threads are on, and the follower's list has the thread.
				for (const session of followerSessions) {
					const ready = session.all('READY')[0].d;
					expect(ready.fork_dm_threads?.enabled).toBe(true);
					expect(ready.fork_dm_threads.threads.map((t: any) => t.id)).toContain(thread.threadId);
				}
				const marks = sessions.map((session) => session.mark());
				const inThread = await post(author, thread.threadId, `in the thread ${stamp()}`);
				// The sentinel: a message in the parent DM, a plain MESSAGE_CREATE on the same account path.
				const inDm = await post(author, thread.dmId, `in the DM ${stamp()}`);
				const sentinel = {t: 'MESSAGE_CREATE', matches: (d: any) => d.id === inDm.id};

				for (const [i, session] of sessions.entries()) {
					const envelope = await session.waitFor(
						'FORK_DM_THREAD_EVENT',
						(d) => d.t === 'MESSAGE_CREATE' && d.d?.id === inThread.id,
						{from: marks[i]},
					);
					expect(envelope.d.d.channel_id).toBe(thread.threadId);
					const plain = await session.absentBefore('MESSAGE_CREATE', (d) => d.id === inThread.id, sentinel, {
						from: marks[i],
					});
					expect(plain, 'a DM-thread message arrived as a plain MESSAGE_CREATE').toEqual([]);
				}
			} finally {
				for (const session of sessions) await session.end();
			}
		});
	}

	test('a follower with no session gets a push titled "Author (Thread)" with the thread fields (1:1 DM)', async () => {
		const author = await account('t7author');
		const follower = await account('t7offline');
		const thread = await dmWithThread(author, follower);
		const sink = await PushSink.start();
		try {
			const message = await post(author, thread.threadId, `offline push ${stamp()}`);
			const job = await sink.waitFor(jobFor(follower.id, message.id), 20_000);
			expectThreadPush(job, author, thread, message.id);
		} finally {
			sink.stop();
		}
	});

	test('a follower with no session gets a push titled "Author (Thread, Group)" in a named group DM', async () => {
		const author = await account('t7author');
		const follower = await account('t7offline');
		const other = await account('t7other');
		const thread = await groupDmWithThread(author, [follower, other]);
		const sink = await PushSink.start();
		try {
			const message = await post(author, thread.threadId, `group push ${stamp()}`);
			for (const who of [follower, other]) {
				const job = await sink.waitFor(jobFor(who.id, message.id), 20_000);
				expectThreadPush(job, author, thread, message.id);
			}
		} finally {
			sink.stop();
		}
	});

	test('a push held back by an online session survives reading the parent DM and goes out when it turns AFK', async () => {
		const author = await account('t7author');
		const follower = await account('t7held');
		const thread = await dmWithThread(author, follower);
		const sink = await PushSink.start();
		// Online and not AFK: the follower's presence holds DM pushes back.
		const session = await GatewayRecorder.connect(baseURL, follower.token, {flags: CHANNEL_THREADS_FLAG});
		try {
			const from = session.mark();
			const inThread = await post(author, thread.threadId, `held in the thread ${stamp()}`);
			await session.waitFor('FORK_DM_THREAD_EVENT', (d) => d.t === 'MESSAGE_CREATE' && d.d?.id === inThread.id, {
				from,
			});
			// A later message in the parent DM, read up to: the read covers the thread message's id too.
			const inDm = await post(author, thread.dmId, `in the DM ${stamp()}`);
			await session.waitFor('MESSAGE_CREATE', (d) => d.id === inDm.id, {from});
			await ack(follower, thread.dmId, inDm.id);
			await session.waitFor('MESSAGE_ACK', (d) => d.channel_id === thread.dmId && d.message_id === inDm.id, {from});

			await goAfk(session);
			const job = await sink.waitFor(jobFor(follower.id, inThread.id), 20_000);
			expectThreadPush(job, author, thread, inThread.id);
		} finally {
			await session.end();
			sink.stop();
		}
	});

	test('reading the thread drops the push an online session held back for it', async () => {
		const author = await account('t7author');
		const follower = await account('t7read');
		const thread = await dmWithThread(author, follower);
		const sink = await PushSink.start(['push.job.message', 'push.job.clear']);
		const session = await GatewayRecorder.connect(baseURL, follower.token, {flags: CHANNEL_THREADS_FLAG});
		try {
			const from = session.mark();
			const inThread = await post(author, thread.threadId, `read in the thread ${stamp()}`);
			await session.waitFor('FORK_DM_THREAD_EVENT', (d) => d.t === 'MESSAGE_CREATE' && d.d?.id === inThread.id, {
				from,
			});
			await ack(follower, thread.threadId, inThread.id);
			// The thread's ack reaches the account in the envelope; once a session has it, so has the presence.
			await session.waitFor(
				'FORK_DM_THREAD_EVENT',
				(d) => d.t === 'MESSAGE_ACK' && d.d?.channel_id === thread.threadId,
				{from},
			);
			// Reading the thread clears its notification: the clear job names the thread.
			const clear = await sink.waitFor(
				(job) =>
					job.subject === 'push.job.clear' &&
					job.body?.user_id === follower.id &&
					job.body?.channel_id === thread.threadId,
				20_000,
			);
			expect(clear.body.message_id).toBe(inThread.id);

			// A message in the parent DM, not read, is held back too: its push shows that the hold was flushed.
			const heldInDm = await post(author, thread.dmId, `held in the DM ${stamp()}`);
			await session.waitFor('MESSAGE_CREATE', (d) => d.id === heldInDm.id, {from});
			await goAfk(session);
			await sink.waitFor(jobFor(follower.id, heldInDm.id), 20_000);
			// The sentinel: with every session AFK, a new DM message is pushed at once. The held thread push, had it
			// survived, went out in the flush with the DM message, before this message existed.
			const sentinel = await post(author, thread.dmId, `after AFK ${stamp()}`);
			const sentinelJob = await sink.waitFor(jobFor(follower.id, sentinel.id), 20_000);
			expect(sentinelJob.body.notification.fork_thread_id).toBeUndefined();
			expect(sink.jobs.filter(jobFor(follower.id, inThread.id)), 'the read thread message was pushed').toEqual([]);
		} finally {
			await session.end();
			sink.stop();
		}
	});

	test('a thread push queued while the push service is down survives reading the parent DM', async () => {
		test.setTimeout(120_000);
		const author = await account('t7author');
		const follower = await account('t7queued');
		const thread = await dmWithThread(author, follower);
		// No sink yet: nothing answers push.job.message, so the gateway's outbox keeps the jobs and retries them
		// (1 s, 2 s, 4 s ... up to 30 s apart).
		const inThread = await post(author, thread.threadId, `queued in the thread ${stamp()}`);
		const inDm = await post(author, thread.dmId, `queued in the DM ${stamp()}`);
		// The follower reads the parent DM up to a message later than the thread's.
		await ack(follower, thread.dmId, inDm.id);
		const sink = await PushSink.start();
		try {
			const job = await sink.waitFor(jobFor(follower.id, inThread.id), 45_000);
			expectThreadPush(job, author, thread, inThread.id);
		} finally {
			sink.stop();
		}
	});
});
