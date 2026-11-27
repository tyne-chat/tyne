// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {Channel} from '@app/features/channel/models/Channel';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const THREAD_ID = '1546500000000000101';
const PARENT_CHANNEL_ID = '1546500000000000100';
const STARTER_MESSAGE_ID = '1546500000000000101';
const REPLY_MESSAGE_ID = '1546500000000000202';
const GUILD_ID = '1546500000000000050';

const {knownChannels, threadStub} = vi.hoisted(() => {
	const threadId = '1546500000000000101';
	return {
		knownChannels: new Set<string>([threadId]),
		threadStub: {
			id: threadId,
			guildId: '1546500000000000050',
			parentId: '1546500000000000100',
			name: 'design-review',
			messageCount: 1,
			lastMessageId: '1546500000000000202',
			isThread: () => true,
		} as unknown as Channel,
	};
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) =>
				values && 'count' in values ? `${String(values.count)} messages` : (descriptor.message ?? ''),
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
		getSnapshotOrNull: () => null,
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: '1546500000000000001'}}));
vi.mock('@app/features/relationship/state/Relationships', () => ({default: {isBlocked: () => false}}));
vi.mock('@app/features/user/state/Users', () => ({default: {cacheUsers: () => {}, getUser: () => null}}));
vi.mock('@app/features/messaging/state/MessageReactions', () => ({
	default: {hydrateMessageReactions: () => {}, replaceMessageReactions: () => {}, getMessageReactions: () => []},
}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {
		getChannel: (id: string) => (knownChannels.has(id) ? threadStub : undefined),
		handleMessageCreate: () => {},
	},
}));
vi.mock('@app/features/threads/state/ThreadGuilds', () => ({
	default: {anyActive: true, isActive: (guildId: string) => guildId === GUILD_ID},
}));
vi.mock('@app/features/threads/state/ChannelThreads', () => ({
	default: {
		getThread: (messageId: string) => (messageId === STARTER_MESSAGE_ID ? threadStub : undefined),
	},
}));
vi.mock('@app/features/threads/fork/ForkThreadNewsMarks', () => ({
	ThreadChipNews: () => null,
}));
vi.mock('@app/features/ui/focus_ring/FocusRing', () => ({
	default: ({children}: {children: unknown}) => children,
}));
vi.mock('@app/features/user/utils/NicknameUtils', () => ({
	getNickname: () => 'Alice',
}));
vi.mock('@app/features/notification/utils/MessageNotificationPreview', () => ({
	buildMessageNotificationBody: (msg: {content: string}) => msg.content,
}));

const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');
const {MessageThreadChip} = await import('@app/features/threads/components/MessageThreadChip');

function makeWireMessage(id: string, channelId: string, content: string): WireMessage {
	return {
		id,
		channel_id: channelId,
		author: {
			id: '1546500000000000010',
			username: 'alice',
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
		content,
		timestamp: '2026-11-27T00:00:00.000Z',
		mentions: [],
		mention_roles: [],
		reactions: [],
	} as unknown as WireMessage;
}

describe('MessageThreadChip tracked Messages.version reads', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Messages.handleSessionInvalidated();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it('re-renders with the latest thread preview when Messages caches the reply and bumps Messages.version', () => {
		const starterMessage = {id: STARTER_MESSAGE_ID, channelId: PARENT_CHANNEL_ID} as unknown as Message;

		act(() => {
			root.render(<MessageThreadChip message={starterMessage} data-flx="messaging.fork-tracked-reads-test.chip" />);
		});

		expect(container.textContent).not.toContain('Fresh thread reply preview');

		act(() => {
			Messages.handleLoadMessagesSuccess({
				channelId: THREAD_ID,
				messages: [makeWireMessage(REPLY_MESSAGE_ID, THREAD_ID, 'Fresh thread reply preview')],
			});
		});

		expect(container.textContent).toContain('Alice: Fresh thread reply preview');
	});
});
