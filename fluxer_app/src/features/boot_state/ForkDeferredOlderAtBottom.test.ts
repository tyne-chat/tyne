// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const reveal = vi.hoisted(() => ({held: true, tasks: [] as Array<() => void>}));

vi.mock('@app/features/boot_state/BootReveal', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/boot_state/BootReveal')>()),
	afterBootReveal: (task: () => void) => {
		if (reveal.held) reveal.tasks.push(task);
		else task();
		return () => {};
	},
}));
vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({Trans: () => null, useLingui: () => ({i18n: {_: () => ''}})}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({http: {get: vi.fn()}}));
vi.mock('@app/features/gateway/transport/GatewaySessionPool', () => ({
	default: {foregroundConnection: {isReady: true, isConnected: true, connectionEpoch: 1}},
}));
vi.mock('@app/features/navigation/state/SelectedChannel', () => ({
	default: {currentChannelId: null, selectedChannelIds: new Map<string, string>()},
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
const {prependDeferredOlderAtBottom} = await import('@app/features/boot_state/ForkDeferredOlderAtBottom');

import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

const BASE = 1546600000000000000n;
const id = (n: number): string => (BASE + BigInt(n)).toString();
const ROW_PX = 40;

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

// Oldest first, as the boot snapshot stores a window.
function rows(channelId: string, from: number, to: number): Array<WireMessage> {
	const messages: Array<WireMessage> = [];
	for (let n = from; n <= to; n++) messages.push(wire(channelId, n));
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

// What hydration does for the selected channel: the newest rows mounted, 1-82 held aside with the
// tops measured when the snapshot was written. Like the report's window: 82 held, 21 mounted.
function restoreWithHeldRows(channelId: string): void {
	const seeded = Messages.seedFromBootState([
		{
			channelId,
			messages: rows(channelId, 83, 103),
			hasMoreBefore: true,
			hasMoreAfter: false,
			anchorMessageId: id(95),
		},
	]).get(channelId);
	if (seeded === undefined) throw new Error('nothing seeded');
	const tops = new Map(range(1, 103).map((messageId, index) => [messageId, index * ROW_PX]));
	Messages.deferSeededOlderMessages(seeded, rows(channelId, 1, 82), true, tops);
}

function revealRestoredList(): void {
	reveal.held = false;
	for (const task of reveal.tasks.splice(0)) task();
}

let channelCounter = 0;
let channelId = '';

beforeEach(() => {
	vi.useFakeTimers();
	reveal.held = true;
	reveal.tasks.length = 0;
	channelCounter += 1;
	channelId = `15466000000000${String(channelCounter).padStart(5, '0')}`;
	restoreWithHeldRows(channelId);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('prependDeferredOlderAtBottom (tyne-chat/tyne#635)', () => {
	it('starts from the reported state: older rows held aside behind a reserve of their height', () => {
		expect(windowIds(channelId)).toEqual(range(83, 103));
		expect(Messages.hasDeferredOlderMessages(channelId)).toBe(true);
		expect(Messages.deferredOlderReserve(channelId)).toEqual({heightPx: 82 * ROW_PX, hasMoreBefore: true});
	});

	it('adds every held row back once the restored list is shown and has settled at the bottom', () => {
		prependDeferredOlderAtBottom(channelId, () => true);
		revealRestoredList();
		vi.advanceTimersByTime(120);

		expect(windowIds(channelId)).toEqual(range(1, 103));
		expect(Messages.hasDeferredOlderMessages(channelId)).toBe(false);
		expect(Messages.deferredOlderReserve(channelId)).toBeNull();
		expect(Messages.getMessages(channelId).hasMoreBefore).toBe(true);
	});

	it('waits for the reveal and then for the settle time, so the first frames are drawn first', () => {
		prependDeferredOlderAtBottom(channelId, () => true);
		vi.advanceTimersByTime(1000);
		expect(Messages.hasDeferredOlderMessages(channelId)).toBe(true);

		revealRestoredList();
		vi.advanceTimersByTime(119);
		expect(Messages.hasDeferredOlderMessages(channelId)).toBe(true);

		vi.advanceTimersByTime(1);
		expect(Messages.hasDeferredOlderMessages(channelId)).toBe(false);
	});

	it('runs at once when the restored list mounts after the reveal', () => {
		revealRestoredList();
		prependDeferredOlderAtBottom(channelId, () => true);
		vi.advanceTimersByTime(120);

		expect(windowIds(channelId)).toEqual(range(1, 103));
	});

	it('leaves the held rows to upstream when the list is not at the bottom when it settles', () => {
		let atBottom = true;
		prependDeferredOlderAtBottom(channelId, () => atBottom);
		revealRestoredList();
		atBottom = false;
		vi.advanceTimersByTime(120);

		expect(windowIds(channelId)).toEqual(range(83, 103));
		expect(Messages.hasDeferredOlderMessages(channelId)).toBe(true);
	});

	it('does nothing once the held rows are gone, as when a reload replaced the window', () => {
		prependDeferredOlderAtBottom(channelId, () => true);
		revealRestoredList();
		Messages.prependDeferredOlderMessages(channelId);
		const before = Messages.getMessages(channelId);
		vi.advanceTimersByTime(120);

		expect(Messages.getMessages(channelId)).toBe(before);
		expect(windowIds(channelId)).toEqual(range(1, 103));
	});
});
