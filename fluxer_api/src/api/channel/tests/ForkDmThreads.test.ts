// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: threads in DMs and group DMs (tyne-chat/tyne#699).

import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createChannelID, createUserID} from '@app/api/BrandedTypes';
import {ChannelRepository} from '@app/api/channel/ChannelRepository';
import {buildDmThreadsReadyField} from '@app/api/channel/services/thread/ForkDmThreadReady';
import {
	blockUser,
	createDmChannel,
	createFriendship,
	createGroupDmChannel,
} from '@app/api/channel/tests/ChannelTestUtils';
import {THREADS_FEATURE, THREADS_FEATURE_HEADER, threadsRequest} from '@app/api/channel/tests/ThreadTestUtils';
import {ensureSessionStarted, sendMessage} from '@app/api/message/tests/MessageTestUtils';
import {ReadStateRepository} from '@app/api/read_state/ReadStateRepository';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {ChannelTypes, MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import {DM_THREAD_GATEWAY_EVENT, DM_THREADS_CLIENT_FEATURE} from '@fluxer/constants/src/ForkDmThreadConstants';
import {ThreadMemberFlags} from '@fluxer/constants/src/ThreadConstants';
import type {ThreadChannelResponse} from '@fluxer/schema/src/domains/channel/ThreadRequestSchemas';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const channels = new ChannelRepository();
const readStates = new ReadStateRepository();

interface Dm {
	a: TestAccount;
	b: TestAccount;
	dmId: string;
}

describe('threads in DMs', () => {
	let harness: ApiTestHarness;
	let previousSwitch: string | undefined;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		previousSwitch = process.env.TYNE_DM_THREADS;
		process.env.TYNE_DM_THREADS = 'all';
	});

	afterEach(() => {
		if (previousSwitch === undefined) delete process.env.TYNE_DM_THREADS;
		else process.env.TYNE_DM_THREADS = previousSwitch;
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	async function dm(): Promise<Dm> {
		const a = await createTestAccount(harness);
		const b = await createTestAccount(harness);
		await createFriendship(harness, a, b);
		const channel = await createDmChannel(harness, a.token, b.userId);
		return {a, b, dmId: channel.id};
	}

	async function startFromMessage(account: TestAccount, dmId: string, name: string): Promise<ThreadChannelResponse> {
		const source = await sendMessage(harness, account.token, dmId, `about ${name}`);
		return threadsRequest<ThreadChannelResponse>(harness, account.token)
			.post(`/channels/${dmId}/messages/${source.id}/threads`)
			.body({name})
			.expect(201)
			.execute();
	}

	async function startStandalone(account: TestAccount, dmId: string, name: string): Promise<ThreadChannelResponse> {
		return threadsRequest<ThreadChannelResponse>(harness, account.token)
			.post(`/channels/${dmId}/threads`)
			.body({name, type: ChannelTypes.PUBLIC_THREAD})
			.expect(201)
			.execute();
	}

	async function sendInThread(account: TestAccount, threadId: string, content: string): Promise<MessageResponse> {
		await ensureSessionStarted(harness, account.token);
		return threadsRequest<MessageResponse>(harness, account.token)
			.post(`/channels/${threadId}/messages`)
			.body({content})
			.execute();
	}

	it('starts a thread from a DM message that both people follow, with no guild', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startFromMessage(a, dmId, 'Trip planning');
		expect(thread.guild_id).toBeUndefined();
		expect(thread.parent_id).toBe(dmId);
		expect(thread.type).toBe(ChannelTypes.PUBLIC_THREAD);
		const members = await channels.threads.getMembers(createChannelID(BigInt(thread.id)), [
			createUserID(BigInt(a.userId)),
			createUserID(BigInt(b.userId)),
		]);
		expect(members.map((member) => member.userId.toString()).sort()).toEqual([a.userId, b.userId].sort());
		const starter = members.find((member) => member.userId.toString() === a.userId);
		expect((starter!.flags & ThreadMemberFlags.HAS_INTERACTED) !== 0).toBe(true);
		await threadsRequest(harness, b.token).get(`/channels/${thread.id}/messages`).execute();
	});

	it('keeps someone outside the DM out of its threads', async () => {
		const {a, dmId} = await dm();
		const outsider = await createTestAccount(harness);
		const thread = await startStandalone(a, dmId, 'Book club picks');
		await threadsRequest(harness, outsider.token).get(`/channels/${thread.id}/messages`).expect(404).execute();
	});

	it('refuses a private thread in a DM', async () => {
		const {a, dmId} = await dm();
		await threadsRequest(harness, a.token)
			.post(`/channels/${dmId}/threads`)
			.body({name: 'Secret', type: ChannelTypes.PRIVATE_THREAD})
			.expect(400)
			.execute();
	});

	it('lets either person in a 1:1 DM rename and close a thread, and nobody lock it', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startStandalone(a, dmId, 'Garden plans');
		const renamed = await threadsRequest<ThreadChannelResponse>(harness, b.token)
			.patch(`/channels/${thread.id}`)
			.body({name: 'Garden'})
			.execute();
		expect(renamed.name).toBe('Garden');
		await threadsRequest(harness, a.token)
			.patch(`/channels/${thread.id}`)
			.body({locked: true})
			.expect(403, APIErrorCodes.MISSING_PERMISSIONS)
			.execute();
		const closed = await threadsRequest<ThreadChannelResponse>(harness, b.token)
			.patch(`/channels/${thread.id}`)
			.body({archived: true})
			.execute();
		expect(closed.thread_metadata?.archived).toBe(true);
	});

	it('lets the starter delete a thread only while nobody else has written in it', async () => {
		const {a, b, dmId} = await dm();
		const quiet = await startStandalone(a, dmId, 'Quiet');
		await threadsRequest(harness, b.token).delete(`/channels/${quiet.id}`).expect(403).execute();
		await threadsRequest(harness, a.token).delete(`/channels/${quiet.id}`).expect(204).execute();
		const busy = await startStandalone(a, dmId, 'Busy');
		await sendInThread(b, busy.id, 'my words too');
		await threadsRequest(harness, a.token).delete(`/channels/${busy.id}`).expect(403).execute();
	});

	it("lets a group DM's owner moderate its threads", async () => {
		const owner = await createTestAccount(harness);
		const second = await createTestAccount(harness);
		const third = await createTestAccount(harness);
		await createFriendship(harness, owner, second);
		await createFriendship(harness, owner, third);
		const group = await createGroupDmChannel(harness, owner.token, [second.userId, third.userId]);
		const thread = await startStandalone(second, group.id, 'Game night');
		await sendInThread(third, thread.id, 'count me in');
		await threadsRequest(harness, third.token)
			.patch(`/channels/${thread.id}`)
			.body({locked: true})
			.expect(403)
			.execute();
		await threadsRequest(harness, owner.token).patch(`/channels/${thread.id}`).body({locked: true}).execute();
		await threadsRequest(harness, owner.token).delete(`/channels/${thread.id}`).expect(204).execute();
	});

	it('refuses to start one when the account switch is off, and still shows existing ones', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startStandalone(a, dmId, 'Before');
		process.env.TYNE_DM_THREADS = '';
		await threadsRequest(harness, a.token)
			.post(`/channels/${dmId}/threads`)
			.body({name: 'After', type: ChannelTypes.PUBLIC_THREAD})
			.expect(403)
			.execute();
		await sendInThread(b, thread.id, 'still here');
	});

	it('counts a thread message for the other person and sends its events in the envelope', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startStandalone(a, dmId, 'Birthday ideas');
		const dispatches = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');
		const message = await sendInThread(a, thread.id, 'cake?');
		const toB = dispatches.mock.calls
			.map(([params]) => params)
			.filter((params) => params.userId.toString() === b.userId && params.event === DM_THREAD_GATEWAY_EVENT);
		const create = toB.find((params) => (params.data as {t: string}).t === 'MESSAGE_CREATE');
		expect(create).toBeDefined();
		const envelope = create!.data as {
			t: string;
			d: {id: string; guild_id?: string};
			push?: {message: Record<string, unknown>};
		};
		expect(envelope.d.id).toBe(message.id);
		expect(envelope.d.guild_id).toBeUndefined();
		expect(envelope.push?.message.channel_id).toBe(dmId);
		expect(envelope.push?.message.fork_thread_id).toBe(thread.id);
		expect(dispatches.mock.calls.some(([params]) => params.event === 'MESSAGE_CREATE')).toBe(false);
		const state = await readStates.getReadState(createUserID(BigInt(b.userId)), createChannelID(BigInt(thread.id)));
		expect(state?.mentionCount).toBe(1);
	});

	it('does not count or push for someone who left the thread', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startStandalone(a, dmId, 'Recipes');
		await threadsRequest(harness, b.token).delete(`/channels/${thread.id}/thread-members/@me`).expect(204).execute();
		const dispatches = vi.spyOn(NoopGatewayService.prototype, 'dispatchPresence');
		await sendInThread(a, thread.id, 'soup');
		const toB = dispatches.mock.calls.find(
			([params]) => params.userId.toString() === b.userId && (params.data as {t?: string}).t === 'MESSAGE_CREATE',
		);
		expect(toB).toBeDefined();
		expect((toB![0].data as {push?: unknown}).push).toBeUndefined();
		const state = await readStates.getReadState(createUserID(BigInt(b.userId)), createChannelID(BigInt(thread.id)));
		expect(state?.mentionCount ?? 0).toBe(0);
	});

	it('keeps thread chips and starter messages in DMs for apps that know DM threads, and strips them for others', async () => {
		const {a, dmId} = await dm();
		const thread = await startFromMessage(a, dmId, 'Movie night');
		await sendInThread(a, thread.id, 'popcorn');
		const list = (path: string, features: string) =>
			createBuilder<Array<MessageResponse>>(harness, a.token)
				.header(THREADS_FEATURE_HEADER, features)
				.get(path)
				.execute();
		const newApp = `${DM_THREADS_CLIENT_FEATURE},${THREADS_FEATURE}`;
		const source = (await list(`/channels/${dmId}/messages`, newApp)).find((message) => message.id === thread.id);
		expect(source?.thread?.id).toBe(thread.id);
		expect(source?.thread?.guild_id).toBeUndefined();
		const inThread = await list(`/channels/${thread.id}/messages`, newApp);
		expect(inThread.some((message) => message.type === MessageTypes.THREAD_STARTER_MESSAGE)).toBe(true);
		const oldSource = (await list(`/channels/${dmId}/messages`, THREADS_FEATURE)).find(
			(message) => message.id === thread.id,
		);
		expect(oldSource).toBeDefined();
		expect(oldSource?.thread).toBeUndefined();
		const oldInThread = await list(`/channels/${thread.id}/messages`, THREADS_FEATURE);
		expect(oldInThread.some((message) => message.type === MessageTypes.THREAD_STARTER_MESSAGE)).toBe(false);
	});

	it("lists a member's open DM threads for READY, with their read states apart", async () => {
		const {a, b, dmId} = await dm();
		const open = await startStandalone(a, dmId, 'Open');
		const closed = await startStandalone(a, dmId, 'Closed');
		await threadsRequest(harness, a.token).patch(`/channels/${closed.id}`).body({archived: true}).execute();
		await sendInThread(a, open.id, 'hello');
		const userId = createUserID(BigInt(b.userId));
		const field = await buildDmThreadsReadyField({
			channelRepository: channels,
			userId,
			readStates: await readStates.listReadStates(userId),
		});
		const threads = field.threads as Array<ThreadChannelResponse>;
		expect(threads.map((thread) => thread.id)).toEqual([open.id]);
		expect(threads[0]!.member?.user_id).toBe(b.userId);
		expect(field.enabled).toBe(true);
		const states = field.read_states as Array<{id: string; mention_count: number}>;
		expect(states.map((state) => state.id)).toEqual([open.id]);
	});
	// Gemini Carbon's review of tyne-chat/tyne#699: a DM thread's row has no recipients, so upstream's DM checks
	// on it failed or found nobody.
	it('lets either person in a 1:1 DM pin and unpin a message in its thread', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startStandalone(a, dmId, 'Pins');
		const message = await sendInThread(b, thread.id, 'pin me');
		await threadsRequest(harness, a.token).put(`/channels/${thread.id}/pins/${message.id}`).expect(204).execute();
		await threadsRequest(harness, b.token).delete(`/channels/${thread.id}/pins/${message.id}`).expect(204).execute();
	});

	it("keeps mentions of the DM's people in its threads, and only theirs", async () => {
		const {a, b, dmId} = await dm();
		const outsider = await createTestAccount(harness);
		const thread = await startStandalone(a, dmId, 'Mentions');
		const message = await sendInThread(a, thread.id, `hi <@${b.userId}> and <@${outsider.userId}>`);
		expect(message.mentions?.map((user) => user.id)).toEqual([b.userId]);
	});

	it('does not let someone blocked rename or reopen a 1:1 DM thread, while closing it still works', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startStandalone(a, dmId, 'Talk');
		await blockUser(harness, a, b.userId);
		await threadsRequest(harness, b.token)
			.patch(`/channels/${thread.id}`)
			.body({name: 'Renamed'})
			.expect(400, APIErrorCodes.CANNOT_SEND_MESSAGES_TO_USER)
			.execute();
		await threadsRequest(harness, a.token).patch(`/channels/${thread.id}`).body({archived: true}).execute();
		await threadsRequest(harness, b.token)
			.patch(`/channels/${thread.id}`)
			.body({archived: false})
			.expect(400, APIErrorCodes.CANNOT_SEND_MESSAGES_TO_USER)
			.execute();
	});

	it('does not let the starter delete a thread the other person wrote in and then left', async () => {
		const {a, b, dmId} = await dm();
		const thread = await startStandalone(a, dmId, 'Left');
		await sendInThread(b, thread.id, 'my words');
		await threadsRequest(harness, b.token).delete(`/channels/${thread.id}/thread-members/@me`).expect(204).execute();
		await threadsRequest(harness, a.token).delete(`/channels/${thread.id}`).expect(403).execute();
	});
});
