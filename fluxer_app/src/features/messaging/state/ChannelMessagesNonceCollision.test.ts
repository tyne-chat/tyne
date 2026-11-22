// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// tyne-chat/tyne#701: a message whose nonce equals the id of an earlier message by the same author
// must not replace that message. Upstream's store took any same-author message whose id equals the
// nonce for the pending copy of the send; with the sender's clock about a second slow, the nonce of
// "fox food" was the id of "will you make me a", which vanished on both screens until a reload.

import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {extractTimestamp, fromTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
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
const {newLocalMessageId} = await import('@app/features/messaging/utils/ForkLocalMessageId');

const CHANNEL = 'channel-701';
const SERAPHIM = '1546500000000000004';
const CHIARA = '1546500000000000005';
// Server ids as production makes them: worker 0, sequence 0, one apart in time.
const T0 = Date.parse('2026-11-16T23:07:22.200Z');
const serverId = (ms: number) => fromTimestamp(ms);

function wire(id: string, authorId: string, content: string, nonce: string | null, state?: string): WireMessage {
	return {
		id,
		channel_id: CHANNEL,
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
		content,
		timestamp: new Date(extractTimestamp(id)).toISOString(),
		mentions: [],
		mention_roles: [],
		reactions: [],
		nonce,
		...(state ? {state} : {}),
	} as WireMessage;
}

const contents = () =>
	ChannelMessages.get(CHANNEL)
		?.toArray()
		.map((message) => message.content) ?? [];
// Pages are loaded newest first, as the API returns them.
const ids = () =>
	ChannelMessages.get(CHANNEL)
		?.toArray()
		.map((message) => message.id) ?? [];

const EAT = wire(serverId(T0), SERAPHIM, 'EAT', null);
const SPEAKING = wire(serverId(T0 + 3_400), SERAPHIM, 'Speaking of eat', null);
const WILL_YOU = wire(serverId(T0 + 5_643), SERAPHIM, 'will you make me a', null);

describe('Messages: a nonce that equals an earlier message id (tyne-chat/tyne#701)', () => {
	beforeEach(() => {
		Messages.handleSessionInvalidated();
		knownChannels.clear();
		knownChannels.add(CHANNEL);
	});

	it("keeps the earlier message when the author's next message arrives with its id as nonce", () => {
		Messages.handleLoadMessagesSuccess({channelId: CHANNEL, messages: [WILL_YOU, SPEAKING, EAT]});

		// The sender's clock read message 3's server millisecond when "fox food" was sent.
		const foxFood = wire(serverId(T0 + 6_700), SERAPHIM, 'fox food', WILL_YOU.id);
		Messages.handleIncomingMessage({channelId: CHANNEL, message: foxFood});

		expect(contents()).toEqual(['EAT', 'Speaking of eat', 'will you make me a', 'fox food']);
		expect(ids()).toEqual([EAT.id, SPEAKING.id, WILL_YOU.id, foxFood.id]);
	});

	it('keeps it too when the earlier message itself arrived live with a nonce of its own', () => {
		Messages.handleLoadMessagesSuccess({channelId: CHANNEL, messages: [SPEAKING, EAT]});
		const live = wire(WILL_YOU.id, SERAPHIM, 'will you make me a', serverId(T0 + 5_600));
		Messages.handleIncomingMessage({channelId: CHANNEL, message: live});

		Messages.handleIncomingMessage({
			channelId: CHANNEL,
			message: wire(serverId(T0 + 6_700), SERAPHIM, 'fox food', WILL_YOU.id),
		});

		expect(contents()).toEqual(['EAT', 'Speaking of eat', 'will you make me a', 'fox food']);
	});

	it("still replaces the sender's own pending copy with the server's message", () => {
		Messages.handleLoadMessagesSuccess({channelId: CHANNEL, messages: [EAT]});
		const nonce = newLocalMessageId(T0 + 1_000);
		Messages.handleIncomingMessage({
			channelId: CHANNEL,
			message: wire(nonce, SERAPHIM, 'Speaking of eat', nonce, 'SENDING'),
		});
		expect(ids()).toEqual([EAT.id, nonce]);

		const delivered = wire(serverId(T0 + 1_050), SERAPHIM, 'Speaking of eat', nonce);
		Messages.handleIncomingMessage({channelId: CHANNEL, message: delivered});

		expect(ids()).toEqual([EAT.id, delivered.id]);
		expect(ChannelMessages.get(CHANNEL)?.get(delivered.id)?.isSending).toBe(false);
	});

	it("keeps another author's message whose id equals the nonce, as upstream did", () => {
		const chiaras = wire(serverId(T0 + 5_643), CHIARA, 'Good fox plan', null);
		Messages.handleLoadMessagesSuccess({channelId: CHANNEL, messages: [chiaras, EAT]});

		Messages.handleIncomingMessage({
			channelId: CHANNEL,
			message: wire(serverId(T0 + 6_700), SERAPHIM, 'fox food', chiaras.id),
		});

		expect(contents()).toEqual(['EAT', 'Good fox plan', 'fox food']);
	});

	it("does not overwrite the earlier message on the sender's screen: the pending copy gets its own id", () => {
		Messages.handleLoadMessagesSuccess({channelId: CHANNEL, messages: [WILL_YOU, SPEAKING, EAT]});

		// Same clock as in the report, but the send's id now comes from newLocalMessageId.
		const nonce = newLocalMessageId(extractTimestamp(WILL_YOU.id));
		expect(nonce).not.toBe(WILL_YOU.id);
		Messages.handleIncomingMessage({channelId: CHANNEL, message: wire(nonce, SERAPHIM, 'fox food', nonce, 'SENDING')});
		expect(contents()).toEqual(['EAT', 'Speaking of eat', 'will you make me a', 'fox food']);

		const delivered = wire(serverId(T0 + 6_700), SERAPHIM, 'fox food', nonce);
		Messages.handleIncomingMessage({channelId: CHANNEL, message: delivered});
		expect(ids()).toEqual([EAT.id, SPEAKING.id, WILL_YOU.id, delivered.id]);
	});
});
