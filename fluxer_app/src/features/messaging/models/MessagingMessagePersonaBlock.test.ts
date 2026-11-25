// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {beforeEach, describe, expect, it, vi} from 'vitest';

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
		getSnapshotOrNull: () => null,
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({
	default: {currentUserId: 'me'},
}));
const blockedAccounts = new Set<string>();
vi.mock('@app/features/relationship/state/Relationships', () => ({
	default: {isBlocked: (id: string) => blockedAccounts.has(id)},
}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {cacheUsers: () => {}, getUser: () => null},
}));
vi.mock('@app/features/messaging/state/MessageReactions', () => ({
	default: {hydrateMessageReactions: () => {}, replaceMessageReactions: () => {}, getMessageReactions: () => []},
}));

const {Message} = await import('@app/features/messaging/models/MessagingMessage');
const {PersonaBlocks} = await import('@app/features/persona/state/PersonaBlocks');

import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

const ACCOUNT = '1546500000000000004';

function wire(personaId: string | null): WireMessage {
	return {
		id: '1546500000000000001',
		channel_id: '1546500000000000002',
		guild_id: '1546500000000000003',
		author: {
			id: ACCOUNT,
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
		content: 'Hello',
		timestamp: '2026-01-01T00:00:00.000Z',
		mentions: [],
		mention_roles: [],
		reactions: [],
		subprofile: personaId ? {id: personaId, name: 'Lyra', avatar: null} : null,
	} as WireMessage;
}

// A blocked persona's messages are blocked as a blocked account's are (tyne-chat/tyne#921).
describe('a message from a blocked persona', () => {
	beforeEach(() => {
		blockedAccounts.clear();
		PersonaBlocks.reset();
	});

	it('is blocked when its persona is, and not when another persona of the account is', () => {
		PersonaBlocks.setBlocks([{user_id: ACCOUNT, persona_id: '10'}]);
		expect(new Message(wire('10'), {skipUserCache: true}).blocked).toBe(true);
		expect(new Message(wire('11'), {skipUserCache: true}).blocked).toBe(false);
		expect(new Message(wire(null), {skipUserCache: true}).blocked).toBe(false);
	});

	it('keeps an explicit value from a copy with updates, so a refresh can unblock it', () => {
		PersonaBlocks.setBlocks([{user_id: ACCOUNT, persona_id: '10'}]);
		const message = new Message(wire('10'), {skipUserCache: true});
		expect(message.withUpdates({blocked: false}).blocked).toBe(false);
	});

	it('is still blocked when the account is blocked, persona or not', () => {
		blockedAccounts.add(ACCOUNT);
		expect(new Message(wire('11'), {skipUserCache: true}).blocked).toBe(true);
		expect(new Message(wire(null), {skipUserCache: true}).blocked).toBe(true);
	});
});
