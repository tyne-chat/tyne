// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// tyne-chat/tyne#635: after a restart, the boot snapshot restored a channel at the bottom with 21
// rows mounted and 82 held aside behind a 7,811 px blank reserve. Scrolling up from the bottom
// crossed the blank reserve, and the older history was missing. This drives upstream's own path with
// the numbers from the desktop app's console: the hook's `lifecycleMergeProps` runs `restoreInitial`,
// the boot reveal releases its tasks, the user scrolls up 3,000 px and the scroll handler decides
// whether to load. The fork's stopgap (`ForkDeferredOlderAtBottom.ts`) must have put the held rows
// back by then.

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
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
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
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

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');
const {rememberRestoredScroll} = await import('@app/features/boot_state/BootViewport');
const {ScrollManager} = await import('@app/features/platform/utils/ScrollManager');
const {Scroller} = await import('@app/features/ui/components/Scroller');

import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

type ScrollManagerProps = ConstructorParameters<typeof ScrollManager>[0];

// From the desktop app's console on tyne-chat/tyne#635.
const VIEWPORT_HEIGHT = 735;
const HEAD_FILLER_PX = 1279;
const RESERVE_PX = 7811;
const SCROLL_HEIGHT = 11263;
const HELD = 82;
const MOUNTED = 21;

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

// Oldest first, as the boot snapshot stores a window.
function rows(channelId: string, from: number, to: number): Array<WireMessage> {
	const messages: Array<WireMessage> = [];
	for (let n = from; n <= to; n++) messages.push(wire(channelId, n));
	return messages;
}

// What hydration does for the channel in the route: mount the newest rows, hold the older ones aside
// with the tops measured when the snapshot was written, and remember that the list was at the bottom.
function restoreFromSnapshot(channelId: string): void {
	const seeded = Messages.seedFromBootState([
		{
			channelId,
			messages: rows(channelId, HELD + 1, HELD + MOUNTED),
			hasMoreBefore: true,
			hasMoreAfter: false,
			anchorMessageId: id(HELD + 13),
		},
	]).get(channelId);
	if (seeded === undefined) throw new Error('nothing seeded');
	const tops = new Map<string, number>();
	for (let n = 1; n <= HELD + MOUNTED; n++) {
		tops.set(id(n), n <= HELD ? Math.round(((n - 1) * RESERVE_PX) / HELD) : RESERVE_PX + (n - HELD - 1) * 67);
	}
	Messages.deferSeededOlderMessages(seeded, rows(channelId, 1, HELD), true, tops);
	rememberRestoredScroll(channelId, {kind: 'bottom'});
}

describe('scrolling up after a restart restored a channel at the bottom (tyne-chat/tyne#635)', () => {
	let container: HTMLDivElement;
	let root: Root;
	let scrollTop: number;
	let channelId: string;
	let channelCounter = 0;

	function props(): ScrollManagerProps {
		return {
			messages: Messages.getMessages(channelId),
			channel: {id: channelId, type: 0},
			compact: false,
			hasPendingUnreads: false,
			focusAnchorId: null,
			unloadedSpacerHeight: HEAD_FILLER_PX,
			allowHistoryFetch: true,
			windowId: 'main',
			notifyPinnedToBottom: () => {},
			notifyUnpinnedFromBottom: () => {},
			extraListPadding: 48,
			canAutoAck: false,
			handleJumpHighlight: () => {},
		} as unknown as ScrollManagerProps;
	}

	// What `useScrollManager` does on each render of the message list.
	function render(manager: InstanceType<typeof ScrollManager>): void {
		act(() => {
			manager.lifecycleGetSnapshotBeforeUpdate(null, Messages.getMessages(channelId));
			manager.lifecycleMergeProps(props());
		});
	}

	function mountRestoredList(): {manager: InstanceType<typeof ScrollManager>; viewport: HTMLElement} {
		const manager = new ScrollManager(props());
		act(() => {
			root.render(
				<Scroller ref={manager.ref} data-flx="platform.scroll-manager-restored-history-test.mount.scroller">
					<div data-flx="platform.scroll-manager-restored-history-test.mount.div" />
				</Scroller>,
			);
		});
		const viewport = manager.ref.current?.getViewportElement();
		if (!viewport) throw new Error('no viewport');
		Object.defineProperties(viewport, {
			scrollTop: {
				configurable: true,
				get: () => scrollTop,
				set: (value: number) => {
					scrollTop = Math.max(0, Math.min(value, SCROLL_HEIGHT - VIEWPORT_HEIGHT));
				},
			},
			scrollHeight: {configurable: true, get: () => SCROLL_HEIGHT},
			offsetHeight: {configurable: true, get: () => VIEWPORT_HEIGHT},
			clientHeight: {configurable: true, get: () => VIEWPORT_HEIGHT},
		});
		render(manager);
		return {manager, viewport};
	}

	function revealRestoredList(): void {
		reveal.held = false;
		for (const task of reveal.tasks.splice(0)) task();
	}

	function scrollUserTo(manager: InstanceType<typeof ScrollManager>, viewport: HTMLElement, top: number): void {
		scrollTop = top;
		const event = new Event('scroll');
		viewport.dispatchEvent(event);
		act(() => manager.scrollHandle(event));
	}

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
		reveal.held = true;
		reveal.tasks.length = 0;
		scrollTop = 0;
		channelCounter += 1;
		channelId = `15466100000000${String(channelCounter).padStart(5, '0')}`;
		restoreFromSnapshot(channelId);
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('restores the reported state: at the bottom, 21 rows mounted, 82 held behind the reserve', () => {
		mountRestoredList();

		expect(scrollTop).toBe(SCROLL_HEIGHT - VIEWPORT_HEIGHT);
		expect(Messages.getMessages(channelId).length).toBe(MOUNTED);
		expect(Messages.deferredOlderReserve(channelId)).toEqual({heightPx: RESERVE_PX, hasMoreBefore: true});
	});

	it('has the older history in the list by the time the user scrolls up into the reserve', () => {
		const {manager, viewport} = mountRestoredList();
		revealRestoredList();
		vi.advanceTimersByTime(1000);
		render(manager);

		// 3,000 px up from the bottom: past the mounted rows, well inside the old blank reserve, far
		// from the head filler where upstream's `loadMore` triggers.
		scrollUserTo(manager, viewport, SCROLL_HEIGHT - VIEWPORT_HEIGHT - 3000);
		vi.advanceTimersByTime(1000);
		render(manager);

		expect(Messages.hasDeferredOlderMessages(channelId)).toBe(false);
		expect(Messages.deferredOlderReserve(channelId)).toBeNull();
		expect(Messages.getMessages(channelId).length).toBe(HELD + MOUNTED);
		expect(Messages.getMessages(channelId).first()?.id).toBe(id(1));
	});
});
