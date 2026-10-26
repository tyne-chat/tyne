// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	selectedChannelId: null as string | null,
	get: vi.fn(),
}));

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({Trans: () => null, useLingui: () => ({i18n: {_: () => ''}})}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({http: {get: mocks.get}}));
vi.mock('@app/features/gateway/transport/GatewaySessionPool', () => ({
	default: {foregroundConnection: {isReady: true, isConnected: true, connectionEpoch: 1}},
}));
vi.mock('@app/features/navigation/state/SelectedChannel', () => ({
	default: {
		get currentChannelId() {
			return mocks.selectedChannelId;
		},
		selectedChannelIds: new Map<string, string>(),
	},
}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {
		getChannel: (id: string) => ({id, guildId: null, lastMessageId: null, isPrivate: () => true}),
		getPrivateChannels: () => [],
		handleMessageCreate: vi.fn(),
	},
}));
// What building a message reads.
vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
		getSnapshotOrNull: () => null,
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: 'me'}}));
vi.mock('@app/features/relationship/state/Relationships', () => ({default: {isBlocked: () => false}}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {cacheUsers: () => {}, getUser: () => null, getCurrentUser: () => null},
}));
vi.mock('@app/features/messaging/state/MessageReactions', () => ({
	default: {hydrateMessageReactions: () => {}, replaceMessageReactions: () => {}, getMessageReactions: () => []},
}));

const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');
const MessageCommands = await import('@app/features/messaging/commands/MessageCommands');
const {messagePageFitsWindow} = await import('@app/features/messaging/commands/ForkMessagePageFit');
const {ChannelMessages} = await import('@app/features/messaging/state/ChannelMessages');

import {MAX_MESSAGES_PER_CHANNEL} from '@fluxer/constants/src/LimitConstants';
import type {MessageId} from '@fluxer/schema/src/branded/WireIds';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

const BASE = 1546600000000000000n;
const id = (n: number): string => (BASE + BigInt(n)).toString();

function wire(channelId: string, n: number): WireMessage {
	return {
		id: id(n),
		channel_id: channelId,
		author: {
			id: '1546500000000000004',
			username: 'author',
			discriminator: '0001',
			global_name: null,
			avatar: null,
			avatar_color: null,
			flags: 0,
		},
		type: 0,
		flags: 0,
		pinned: false,
		mention_everyone: false,
		tts: false,
		content: `message ${n}`,
		timestamp: '2026-01-01T00:00:00.000Z',
		mentions: [],
		mention_roles: [],
		reactions: [],
	} as WireMessage;
}

// Newest first, as the API returns a page.
function page(channelId: string, from: number, to: number): Array<WireMessage> {
	const messages: Array<WireMessage> = [];
	for (let n = to; n >= from; n--) messages.push(wire(channelId, n));
	return messages;
}

function range(from: number, to: number): Array<string> {
	const ids: Array<string> = [];
	for (let n = from; n <= to; n++) ids.push(id(n));
	return ids;
}

function windowIds(channelId: string): Array<string> {
	return Messages.getMessages(channelId)
		.toArray()
		.map((message) => message.id);
}

interface PageQuery {
	before: string | null;
	after: string | null;
	around: string | null;
}

interface HeldRequest {
	query: PageQuery;
	respond: (messages: Array<WireMessage>) => void;
}

// Every request waits until the test answers it, so a test decides what lands in which order.
const held: Array<HeldRequest> = [];
const arrivals: Array<() => void> = [];

function holdRequests(): void {
	mocks.get.mockImplementation(
		(_url: string, options: {query: PageQuery}) =>
			new Promise((resolve) => {
				held.push({query: options.query, respond: (messages) => resolve({body: messages})});
				for (const notify of arrivals.splice(0)) notify();
			}),
	);
}

async function nextRequest(query: Partial<PageQuery>): Promise<HeldRequest> {
	const matches = (request: HeldRequest): boolean =>
		(query.before === undefined || request.query.before === query.before) &&
		(query.after === undefined || request.query.after === query.after) &&
		(query.around === undefined || request.query.around === query.around);
	for (;;) {
		const index = held.findIndex(matches);
		if (index !== -1) return held.splice(index, 1)[0];
		await new Promise<void>((resolve) => arrivals.push(resolve));
	}
}

async function load(channelId: string, before: string | null, messages: Array<WireMessage>): Promise<void> {
	const done = MessageCommands.fetchMessages(channelId, before, null, MAX_MESSAGES_PER_CHANNEL);
	(await nextRequest({before, after: null})).respond(messages);
	await done;
}

// The latest page and two older ones, as ScrollManager loads them when scrolling up: 151-300.
async function openScrolledUp(channelId: string): Promise<void> {
	mocks.selectedChannelId = channelId;
	await load(channelId, null, page(channelId, 251, 300));
	await load(channelId, id(251), page(channelId, 201, 250));
	await load(channelId, id(201), page(channelId, 151, 200));
	expect(windowIds(channelId)).toEqual(range(151, 300));
	expect(Messages.getMessages(channelId).hasMoreAfter).toBe(false);
	expect(Messages.getMessages(channelId).error).toBe(false);
}

// What a reload of the selected channel (READY) sends; an identical call shares it.
function reloadInFlight(channelId: string): Promise<Array<WireMessage>> {
	return MessageCommands.fetchMessages(channelId, null, null, MAX_MESSAGES_PER_CHANNEL);
}

describe('pages whose window changed while they loaded (tyne-chat/tyne#212)', () => {
	beforeEach(() => {
		holdRequests();
	});

	afterEach(() => {
		Messages.handleSessionInvalidated();
		mocks.selectedChannelId = null;
		held.length = 0;
		mocks.get.mockReset();
	});

	it('applies an older page when a live message trimmed a few messages meanwhile: the buffer bridges them', async () => {
		const channelId = '1555752678099779606';
		mocks.selectedChannelId = channelId;
		await load(channelId, null, page(channelId, 251, 300));
		await load(channelId, id(251), page(channelId, 201, 250));
		const older = MessageCommands.fetchMessages(channelId, id(201), null, MAX_MESSAGES_PER_CHANNEL);
		const request = await nextRequest({before: id(201)});
		Messages.handleIncomingMessage({channelId, message: wire(channelId, 301)});
		expect(windowIds(channelId)).toEqual(range(202, 301));
		const requestsSoFar = mocks.get.mock.calls.length;
		request.respond(page(channelId, 151, 200));
		await older;
		expect(windowIds(channelId)).toEqual(range(151, 301));
		expect(mocks.get.mock.calls.length).toBe(requestsSoFar);
		expect(Messages.getMessages(channelId).loadingMore).toBe(false);
		expect(Messages.getMessages(channelId).error).toBe(false);
	});

	it('drops an older page when a live message trimmed more than a page meanwhile, after serving the buffer', async () => {
		const channelId = '1555752678099779601';
		await openScrolledUp(channelId);
		const older = MessageCommands.fetchMessages(channelId, id(151), null, MAX_MESSAGES_PER_CHANNEL);
		const request = await nextRequest({before: id(151)});
		Messages.handleIncomingMessage({channelId, message: wire(channelId, 301)});
		expect(windowIds(channelId)).toEqual(range(202, 301));
		const requestsSoFar = mocks.get.mock.calls.length;
		request.respond(page(channelId, 101, 150));
		await older;
		// One page of the 51 trimmed messages came back from the buffer; the page itself did not fit.
		expect(windowIds(channelId)).toEqual(range(152, 301));
		expect(Messages.getMessages(channelId).loadingMore).toBe(false);
		await MessageCommands.fetchMessages(channelId, id(152), null, MAX_MESSAGES_PER_CHANNEL);
		expect(windowIds(channelId)).toEqual(range(151, 301));
		expect(mocks.get.mock.calls.length).toBe(requestsSoFar);
		// The dropped page is asked for again once the buffer is empty: one more request.
		const again = MessageCommands.fetchMessages(channelId, id(151), null, MAX_MESSAGES_PER_CHANNEL);
		(await nextRequest({before: id(151)})).respond(page(channelId, 101, 150));
		await again;
		expect(mocks.get.mock.calls.length).toBe(requestsSoFar + 1);
		expect(windowIds(channelId)).toEqual(range(101, 200));
		expect(Messages.getMessages(channelId).error).toBe(false);
	});

	it('drops an older page that lands after a reload replaced the window', async () => {
		const channelId = '1555752678099779602';
		await openScrolledUp(channelId);
		const older = MessageCommands.fetchMessages(channelId, id(151), null, MAX_MESSAGES_PER_CHANNEL);
		const olderRequest = await nextRequest({before: id(151)});
		Messages.handleGatewayReady();
		const reload = reloadInFlight(channelId);
		(await nextRequest({before: null, after: null})).respond(page(channelId, 351, 400));
		await reload;
		olderRequest.respond(page(channelId, 101, 150));
		await older;
		expect(windowIds(channelId)).toEqual(range(351, 400));
		expect(Messages.getMessages(channelId).loadingMore).toBe(false);
		expect(Messages.getMessages(channelId).error).toBe(false);
	});

	it('drops an older page that lands while a reload is in flight, and leaves the reload in charge', async () => {
		const channelId = '1555752678099779603';
		await openScrolledUp(channelId);
		const older = MessageCommands.fetchMessages(channelId, id(151), null, MAX_MESSAGES_PER_CHANNEL);
		const olderRequest = await nextRequest({before: id(151)});
		Messages.handleGatewayReady();
		const reload = reloadInFlight(channelId);
		const reloadRequest = await nextRequest({before: null, after: null});
		olderRequest.respond(page(channelId, 101, 150));
		await older;
		const meanwhile = Messages.getMessages(channelId);
		expect(meanwhile.has(id(101), false)).toBe(false);
		expect(meanwhile.ready).toBe(false);
		expect(meanwhile.loadingMore).toBe(true);
		reloadRequest.respond(page(channelId, 351, 400));
		await reload;
		expect(windowIds(channelId)).toEqual(range(351, 400));
		expect(Messages.getMessages(channelId).error).toBe(false);
	});

	it('leaves a newer load in charge when an older page from before a reload lands late', async () => {
		const channelId = '1555752678099779607';
		await openScrolledUp(channelId);
		const stale = MessageCommands.fetchMessages(channelId, id(151), null, MAX_MESSAGES_PER_CHANNEL);
		const staleRequest = await nextRequest({before: id(151)});
		Messages.handleGatewayReady();
		const reload = reloadInFlight(channelId);
		(await nextRequest({before: null, after: null})).respond(page(channelId, 351, 400));
		await reload;
		const newer = MessageCommands.fetchMessages(channelId, id(351), null, MAX_MESSAGES_PER_CHANNEL);
		const newerRequest = await nextRequest({before: id(351)});
		staleRequest.respond(page(channelId, 101, 150));
		await stale;
		expect(windowIds(channelId)).toEqual(range(351, 400));
		expect(Messages.getMessages(channelId).loadingMore).toBe(true);
		newerRequest.respond(page(channelId, 301, 350));
		await newer;
		expect(windowIds(channelId)).toEqual(range(301, 400));
		expect(Messages.getMessages(channelId).loadingMore).toBe(false);
		expect(Messages.getMessages(channelId).error).toBe(false);
	});

	it('drops a newer page that lands after a reload replaced the window', async () => {
		const channelId = '1555752678099779604';
		mocks.selectedChannelId = channelId;
		const jump = MessageCommands.fetchMessages(channelId, null, null, MAX_MESSAGES_PER_CHANNEL, {
			messageId: id(100) as MessageId,
		});
		(await nextRequest({around: id(100)})).respond(page(channelId, 76, 125));
		await jump;
		expect(windowIds(channelId)).toEqual(range(76, 125));
		expect(Messages.getMessages(channelId).hasMoreAfter).toBe(true);
		const newer = MessageCommands.fetchMessages(channelId, null, id(125), MAX_MESSAGES_PER_CHANNEL);
		const newerRequest = await nextRequest({after: id(125)});
		Messages.handleGatewayReady();
		const reload = reloadInFlight(channelId);
		(await nextRequest({before: null, after: null, around: null})).respond(page(channelId, 351, 400));
		await reload;
		newerRequest.respond(page(channelId, 126, 175));
		await newer;
		expect(windowIds(channelId)).toEqual(range(351, 400));
		expect(Messages.getMessages(channelId).error).toBe(false);
	});
});

describe('messagePageFitsWindow', () => {
	it('fits a page only to the edge of a ready window that it was asked for', () => {
		const channelId = '1555752678099779605';
		const window = new ChannelMessages(channelId).applyLoadedWindow({
			windowMessages: page(channelId, 1, 50),
			hasMoreBefore: true,
			hasMoreAfter: true,
		});
		expect(messagePageFitsWindow(window, id(1), null)).toBe(true);
		expect(messagePageFitsWindow(window, id(2), null)).toBe(false);
		expect(messagePageFitsWindow(window, null, id(50))).toBe(true);
		expect(messagePageFitsWindow(window, null, id(49))).toBe(false);
		expect(messagePageFitsWindow(window, null, null)).toBe(true);
		expect(messagePageFitsWindow(window.withPatch({ready: false}), id(1), null)).toBe(false);
		expect(messagePageFitsWindow(undefined, id(1), null)).toBe(false);
	});
});
