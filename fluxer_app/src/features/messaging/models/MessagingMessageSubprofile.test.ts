// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({
	default: {currentUserId: 'me'},
}));
vi.mock('@app/features/relationship/state/Relationships', () => ({
	default: {isBlocked: () => false},
}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {
		cacheUsers: () => {},
		getUser: () => null,
	},
}));
export const mockHydrateMessageReactions = vi.fn();
vi.mock('@app/features/messaging/state/MessageReactions', () => ({
	default: {
		hydrateMessageReactions: (...args: Array<unknown>) => mockHydrateMessageReactions(...args),
		replaceMessageReactions: () => {},
		getMessageReactions: () => [],
	},
}));

installVoiceMenuTestBootstrap();

const {Message} = await import('@app/features/messaging/models/MessagingMessage');

import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

function createWireMessage(overrides?: Partial<WireMessage>): WireMessage {
	return {
		id: '1546500000000000001',
		channel_id: '1546500000000000002',
		guild_id: '1546500000000000003',
		author: {
			id: '1546500000000000004',
			username: 'root_user',
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
		content: 'Hello world',
		timestamp: '2026-01-01T00:00:00.000Z',
		mentions: [],
		mention_roles: [],
		reactions: [],
		subprofile: {
			id: 'sub-alice',
			name: 'Alice',
			avatar: 'https://example.com/alice.png',
			system_name: 'Wonderland',
			pronouns: 'she/her',
			color: 0xff0000,
			bio: 'Curiouser and curiouser',
		},
		...overrides,
	};
}

describe('MessagingMessage Subprofile Preservation', () => {
	it('initializes subprofile correctly from wire payload', () => {
		const wire = createWireMessage();
		const msg = new Message(wire, {skipUserCache: true});
		expect(msg.subprofile?.id).toBe('sub-alice');
		expect(msg.subprofile?.name).toBe('Alice');
		expect(msg.subprofile?.avatar).toBe('https://example.com/alice.png');
	});

	it('preserves subprofile across empty withUpdates ({}) such as reactions', () => {
		const wire = createWireMessage();
		const msg = new Message(wire, {skipUserCache: true});
		expect(msg.subprofile?.name).toBe('Alice');

		const updated = msg.withUpdates({});
		expect(updated.subprofile).toBeDefined();
		expect(updated.subprofile?.id).toBe('sub-alice');
		expect(updated.subprofile?.name).toBe('Alice');
	});

	it('updates subprofile when explicitly provided in withUpdates', () => {
		const wire = createWireMessage();
		const msg = new Message(wire, {skipUserCache: true});

		const updated = msg.withUpdates({
			subprofile: {
				id: 'sub-bob',
				name: 'Bob',
				avatar: null,
				system_name: null,
				pronouns: 'he/him',
				color: 0x0000ff,
				bio: null,
			},
		});

		expect(updated.subprofile?.id).toBe('sub-bob');
		expect(updated.subprofile?.name).toBe('Bob');
	});

	it('clears subprofile when explicitly passed null in withUpdates', () => {
		const wire = createWireMessage();
		const msg = new Message(wire, {skipUserCache: true});

		const updated = msg.withUpdates({subprofile: null});
		expect(updated.subprofile).toBeNull();
	});

	it('preserves subprofile across withReaction', () => {
		const wire = createWireMessage();
		const msg = new Message(wire, {skipUserCache: true});

		const reacted = msg.withReaction({name: '🔥'}, true, false);
		expect(reacted.subprofile?.id).toBe('sub-alice');
		expect(reacted.subprofile?.name).toBe('Alice');
	});

	it('skips reaction hydration during withUpdates', () => {
		mockHydrateMessageReactions.mockClear();
		const wire = createWireMessage();
		const msg = new Message(wire, {skipUserCache: true});
		mockHydrateMessageReactions.mockClear();
		msg.withUpdates({});
		expect(mockHydrateMessageReactions).not.toHaveBeenCalled();
	});
});
