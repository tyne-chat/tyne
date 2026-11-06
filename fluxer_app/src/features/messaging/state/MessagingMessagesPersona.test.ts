// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// The fork's persona index in upstream's Messages store: loaded messages are indexed by the persona
// they were sent as, so a persona update reaches them and PersonaRefresh knows whose personas the
// client holds; a channel that goes away takes its entries with it. Also the fork's reading of a
// MESSAGE_UPDATE without a persona.

import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const knownChannels = vi.hoisted(() => new Set<string>());

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
vi.mock('@app/features/user/state/Users', () => ({default: {cacheUsers: () => {}, getUser: () => null}}));
vi.mock('@app/features/messaging/state/MessageReactions', () => ({
	default: {hydrateMessageReactions: () => {}, replaceMessageReactions: () => {}, getMessageReactions: () => []},
}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {
		getChannel: (id: string) => (knownChannels.has(id) ? {id, guildId: 'guild-1'} : undefined),
		handleMessageCreate: () => {},
	},
}));

const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');
const {ChannelMessages} = await import('@app/features/messaging/state/ChannelMessages');

const ALICE = '1546500000000000004';
const BOB = '1546500000000000005';
let nextId = 1546500000000001000n;

function persona(id: string, name: string): MessageSubprofileResponse {
	return {id, name, avatar: null, display_tag_text: 'SYS'};
}

function wire(channelId: string, authorId: string, subprofile: MessageSubprofileResponse | null): WireMessage {
	nextId += 1n;
	return {
		id: nextId.toString(),
		channel_id: channelId,
		author: {
			id: authorId,
			username: `user-${authorId}`,
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
		content: 'hello',
		timestamp: '2026-11-04T00:00:00.000Z',
		mentions: [],
		mention_roles: [],
		reactions: [],
		subprofile,
	} as WireMessage;
}

function load(channelId: string, messages: Array<WireMessage>): void {
	knownChannels.add(channelId);
	Messages.handleLoadMessagesSuccess({channelId, messages});
}

const personasOf = (authorId: string) => Messages.getPersonaIdsByAuthor(authorId).sort();
const nameIn = (channelId: string, messageId: string) =>
	ChannelMessages.get(channelId)?.get(messageId)?.subprofile?.name;

describe('Messages: the persona index', () => {
	beforeEach(() => {
		Messages.handleSessionInvalidated();
		knownChannels.clear();
	});

	it('lists the personas an author wrote loaded messages as, and only theirs', () => {
		load('channel-a', [
			wire('channel-a', ALICE, persona('p-kit', 'Kit')),
			wire('channel-a', ALICE, null),
			wire('channel-a', BOB, persona('p-fox', 'Fox')),
		]);
		load('channel-b', [wire('channel-b', ALICE, persona('p-moss', 'Moss'))]);

		expect(personasOf(ALICE)).toEqual(['p-kit', 'p-moss']);
		expect(personasOf(BOB)).toEqual(['p-fox']);
		expect(personasOf('1546500000000000099')).toEqual([]);
	});

	it('updates a persona in every loaded channel where it wrote', () => {
		const first = wire('channel-a', ALICE, persona('p-kit', 'Kit'));
		const second = wire('channel-b', ALICE, persona('p-kit', 'Kit'));
		load('channel-a', [first]);
		load('channel-b', [second]);
		const version = Messages.version;

		expect(Messages.handlePersonaUpdate({persona: persona('p-kit', 'Kit renamed')})).toBe(true);

		expect(nameIn('channel-a', first.id)).toBe('Kit renamed');
		expect(nameIn('channel-b', second.id)).toBe('Kit renamed');
		expect(Messages.version).toBe(version + 1);
		expect(Messages.handlePersonaUpdate({persona: persona('p-nobody', 'Nobody')})).toBe(false);
	});

	it('follows a message that changes persona, goes back to the account or is deleted', () => {
		const message = wire('channel-a', ALICE, persona('p-kit', 'Kit'));
		const other = wire('channel-a', ALICE, persona('p-moss', 'Moss'));
		load('channel-a', [message, other]);

		Messages.handleMessageUpdate({message: {...message, subprofile: persona('p-fox', 'Fox')}});
		expect(personasOf(ALICE)).toEqual(['p-fox', 'p-moss']);

		Messages.handleMessageUpdate({message: {...message, subprofile: null}});
		expect(personasOf(ALICE)).toEqual(['p-moss']);

		Messages.handleMessageDelete({id: other.id, channelId: 'channel-a'});
		expect(personasOf(ALICE)).toEqual([]);
		expect(Messages.handlePersonaUpdate({persona: persona('p-moss', 'Moss renamed')})).toBe(false);
	});

	it("forgets a deleted channel's personas when the store cleans up, and keeps the other channels'", () => {
		load('channel-a', [wire('channel-a', ALICE, persona('p-kit', 'Kit'))]);
		const kept = wire('channel-b', ALICE, persona('p-moss', 'Moss'));
		load('channel-b', [kept]);

		knownChannels.delete('channel-a');
		Messages.handleCleanup();

		expect(ChannelMessages.get('channel-a')).toBeUndefined();
		expect(personasOf(ALICE)).toEqual(['p-moss']);
		expect(Messages.handlePersonaUpdate({persona: persona('p-kit', 'Kit renamed')})).toBe(false);
		expect(Messages.handlePersonaUpdate({persona: persona('p-moss', 'Moss renamed')})).toBe(true);
		expect(nameIn('channel-b', kept.id)).toBe('Moss renamed');
	});

	it('forgets the personas of a channel the cache let go, and a persona update then finds nothing there', () => {
		load('channel-old', [wire('channel-old', ALICE, persona('p-kit', 'Kit'))]);

		// Reading a message of a channel not loaded yet makes room for it, as the cache holds 50.
		for (let i = 0; i < 50; i += 1) Messages.getMessage(`channel-${i}`, '1');
		expect(ChannelMessages.get('channel-old')).toBeUndefined();

		expect(Messages.handlePersonaUpdate({persona: persona('p-kit', 'Kit renamed')})).toBe(false);
		expect(personasOf(ALICE)).toEqual([]);
	});
});

describe('Messages: a MESSAGE_UPDATE and the persona', () => {
	beforeEach(() => {
		Messages.handleSessionInvalidated();
		knownChannels.clear();
	});

	it("makes a persona's message the account's when the update has an author and no persona", () => {
		const message = wire('channel-a', ALICE, persona('p-kit', 'Kit'));
		load('channel-a', [message]);
		const {subprofile: _omitted, ...withoutPersona} = message;

		expect(Messages.handleMessageUpdate({message: {...withoutPersona, content: 'edited'} as WireMessage})).toBe(true);

		const updated = ChannelMessages.get('channel-a')?.get(message.id);
		expect(updated?.content).toBe('edited');
		expect(updated?.subprofile ?? null).toBeNull();
		expect(personasOf(ALICE)).toEqual([]);
	});

	it('keeps the persona for an update without an author, such as new embeds', () => {
		const message = wire('channel-a', ALICE, persona('p-kit', 'Kit'));
		load('channel-a', [message]);
		const {subprofile: _omitted, author: _author, ...partial} = message;

		Messages.handleMessageUpdate({message: {...partial, embeds: []} as unknown as WireMessage});

		expect(nameIn('channel-a', message.id)).toBe('Kit');
		expect(personasOf(ALICE)).toEqual(['p-kit']);
	});

	it('changes nothing for a message that is not loaded', () => {
		expect(Messages.handleMessageUpdate({message: wire('channel-z', ALICE, null)})).toBe(false);
	});
});
