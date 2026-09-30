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
const {default: MessageReferences, MessageReferenceState} = await import(
	'@app/features/messaging/state/MessageReferences'
);
const {ChannelMessages} = await import('@app/features/messaging/state/ChannelMessages');

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
			display_tag_text: 'Wonderland',
			pronouns: 'she/her',
			color: 0xff0000,
			bio: 'Curiouser and curiouser',
		},
		...overrides,
	};
}

describe('MessagingMessage Persona Preservation', () => {
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

	it('preserves subprofile on referencedMessage when constructing a reply message', () => {
		const referencedWire = createWireMessage({
			id: '1546500000000000099',
			content: 'Original subprofile message',
			subprofile: {
				id: 'sub-bob',
				name: 'Bob the Fox',
				avatar: 'https://example.com/bob.png',
				display_tag_text: 'Foxes',
				pronouns: 'he/him',
				color: 0xff8800,
				bio: 'A cunning fox',
			},
		});

		const replyWire = createWireMessage({
			id: '1546500000000000100',
			content: 'Replying to bob',
			referenced_message: referencedWire,
			message_reference: {
				channel_id: referencedWire.channel_id,
				message_id: referencedWire.id,
				type: 0,
			},
		});

		const replyMsg = new Message(replyWire, {skipUserCache: true});
		expect(replyMsg.referencedMessage).toBeDefined();
		expect(replyMsg.referencedMessage?.subprofile?.name).toBe('Bob the Fox');
		expect(replyMsg.referencedMessage?.subprofile?.avatar).toBe('https://example.com/bob.png');
		expect(replyMsg.referencedMessage?.subprofile?.color).toBe(0xff8800);
	});

	it('initializes display_tag_text and display_tag_icon correctly on subprofile', () => {
		const wire = createWireMessage({
			subprofile: {
				id: 'sub-alice',
				name: 'Alice',
				avatar: 'https://example.com/alice.png',
				display_tag_text: 'TEST SYSTEM',
				display_tag_icon: 'https://example.com/icon.png',
				pronouns: 'she/her',
				color: 0xff0000,
				bio: 'Curiouser and curiouser',
			},
		});
		const msg = new Message(wire, {skipUserCache: true});
		expect(msg.subprofile?.display_tag_text).toBe('TEST SYSTEM');
		expect(msg.subprofile?.display_tag_icon).toBe('https://example.com/icon.png');
	});

	it('distinguishes messages with different display tags in equals()', () => {
		const wire1 = createWireMessage({
			subprofile: {
				id: 'sub-alice',
				name: 'Alice',
				avatar: 'https://example.com/alice.png',
				display_tag_text: 'TAG ONE',
				display_tag_icon: null,
				pronouns: null,
				color: null,
				bio: null,
			},
		});
		const wire2 = createWireMessage({
			subprofile: {
				id: 'sub-alice',
				name: 'Alice',
				avatar: 'https://example.com/alice.png',
				display_tag_text: 'TAG TWO',
				display_tag_icon: null,
				pronouns: null,
				color: null,
				bio: null,
			},
		});

		const msg1 = new Message(wire1, {skipUserCache: true});
		const msg2 = new Message(wire2, {skipUserCache: true});
		expect(msg1.equals(msg2)).toBe(false);
	});

	describe('MessageReferences persona integration', () => {
		it('preserves existing subprofile when unhydrated referenced_message arrives', () => {
			const channelId = '1546500000000000002';
			const refMsgId = '1546500000000000010';
			const replyMsgId = '1546500000000000020';

			const initialReferencedWire = createWireMessage({
				id: refMsgId,
				channel_id: channelId,
				subprofile: {
					id: 'sub-sneaks',
					name: 'Sneaks',
					avatar: 'https://example.com/sneaks.png',
					display_tag_text: 'SERAPHIM',
					display_tag_icon: null,
					pronouns: null,
					color: null,
					bio: null,
				},
			});

			const optimisticReply = createWireMessage({
				id: replyMsgId,
				channel_id: channelId,
				referenced_message: initialReferencedWire,
				message_reference: {
					channel_id: channelId,
					message_id: refMsgId,
					type: 0,
				},
			});

			MessageReferences.handleMessageCreate(optimisticReply, true);

			let resolution = MessageReferences.getMessageReference(channelId, refMsgId);
			expect(resolution.state).toBe(MessageReferenceState.LOADED);
			if (resolution.state === MessageReferenceState.LOADED) {
				expect(resolution.message.subprofile?.name).toBe('Sneaks');
			}

			// Finalized message arrives with subprofile: null
			const finalizedReply = createWireMessage({
				id: replyMsgId,
				channel_id: channelId,
				referenced_message: {
					...initialReferencedWire,
					subprofile: null,
				},
				message_reference: {
					channel_id: channelId,
					message_id: refMsgId,
					type: 0,
				},
			});

			MessageReferences.handleMessageCreate(finalizedReply, false);

			resolution = MessageReferences.getMessageReference(channelId, refMsgId);
			expect(resolution.state).toBe(MessageReferenceState.LOADED);
			if (resolution.state === MessageReferenceState.LOADED) {
				expect(resolution.message.subprofile?.name).toBe('Sneaks');
			}
		});

		it('prioritizes live Messages store message over cache in getMessageReference', () => {
			const channelId = '1546500000000000002';
			const refMsgId = '1546500000000000030';
			const replyMsgId = '1546500000000000040';

			const liveWire = createWireMessage({
				id: refMsgId,
				channel_id: channelId,
				subprofile: {
					id: 'sub-bob',
					name: 'Bob the Fox',
					avatar: 'https://example.com/bob.png',
					display_tag_text: null,
					display_tag_icon: null,
					pronouns: null,
					color: null,
					bio: null,
				},
			});
			const liveMsg = new Message(liveWire, {skipUserCache: true});
			const spy = vi.spyOn(ChannelMessages, 'getOrCreate').mockReturnValue({
				get: (mId: string) => (mId === refMsgId ? liveMsg : undefined),
			} as any);

			const reply = createWireMessage({
				id: replyMsgId,
				channel_id: channelId,
				referenced_message: createWireMessage({
					id: refMsgId,
					channel_id: channelId,
					subprofile: null,
				}),
				message_reference: {
					channel_id: channelId,
					message_id: refMsgId,
					type: 0,
				},
			});
			MessageReferences.handleMessageCreate(reply, false);

			const resolution = MessageReferences.getMessageReference(channelId, refMsgId);
			expect(resolution.state).toBe(MessageReferenceState.LOADED);
			if (resolution.state === MessageReferenceState.LOADED) {
				expect(resolution.message.subprofile?.name).toBe('Bob the Fox');
			}
			spy.mockRestore();
		});
	});

	describe('Messages.handlePersonaUpdate & normalizeSubprofile', () => {
		const channelId = '1546500000000000002';
		const messageId = '1546500000000000099';
		const personaId = 'sub-test-persona';

		it('normalizes API PersonaResponse (avatar_hash) and updates message subprofile', async () => {
			const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');
			const {normalizeSubprofile} = await import('@app/features/persona/state/PersonaStore');
			const wire = createWireMessage({
				id: messageId,
				channel_id: channelId,
				subprofile: {
					id: personaId,
					name: 'Original Name',
					avatar: 'orig_hash',
					display_tag_text: 'ORIG_TAG',
					pronouns: 'they/them',
					color: 0x112233,
					bio: 'bio text',
				},
			});
			(Messages as any).commitMessages(ChannelMessages.getOrCreate(channelId).applyIncomingMessage(wire, false));

			const subprofile = normalizeSubprofile({
				id: personaId,
				name: 'Updated Name',
				avatar_hash: 'new_api_avatar_hash',
			} as any);

			expect(subprofile.avatar).toBe('new_api_avatar_hash');

			const updated = Messages.handlePersonaUpdate({persona: subprofile});

			expect(updated).toBe(true);
			const channelMessages = ChannelMessages.get(channelId);
			const msg = channelMessages?.get(messageId);
			expect(msg?.subprofile?.name).toBe('Updated Name');
			expect(msg?.subprofile?.avatar).toBe('new_api_avatar_hash');
			expect(msg?.subprofile?.display_tag_text).toBe('ORIG_TAG');
			expect(msg?.subprofile?.pronouns).toBe('they/them');
		});

		it('normalizes client ClientPersona (avatarHash) and updates message subprofile', async () => {
			const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');
			const {normalizeSubprofile} = await import('@app/features/persona/state/PersonaStore');
			const wire = createWireMessage({
				id: messageId,
				channel_id: channelId,
				subprofile: {
					id: personaId,
					name: 'Original Name',
					avatar: 'orig_hash',
					display_tag_text: 'ORIG_TAG',
				},
			});
			(Messages as any).commitMessages(ChannelMessages.getOrCreate(channelId).applyIncomingMessage(wire, false));

			const subprofile = normalizeSubprofile({
				id: personaId,
				name: 'Client Updated',
				avatarHash: 'new_client_avatar_hash',
			} as any);

			expect(subprofile.avatar).toBe('new_client_avatar_hash');

			const updated = Messages.handlePersonaUpdate({persona: subprofile});

			expect(updated).toBe(true);
			const channelMessages = ChannelMessages.get(channelId);
			const msg = channelMessages?.get(messageId);
			expect(msg?.subprofile?.name).toBe('Client Updated');
			expect(msg?.subprofile?.avatar).toBe('new_client_avatar_hash');
		});

		it('updates message subprofile from snapshot MessageSubprofileResponse directly', async () => {
			const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');
			const wire = createWireMessage({
				id: messageId,
				channel_id: channelId,
				subprofile: {
					id: personaId,
					name: 'Original Name',
					avatar: 'orig_hash',
				},
			});
			(Messages as any).commitMessages(ChannelMessages.getOrCreate(channelId).applyIncomingMessage(wire, false));

			const updated = Messages.handlePersonaUpdate({
				persona: {
					id: personaId,
					name: 'Snapshot Updated',
					avatar: 'new_snapshot_avatar',
					avatar_color: null,
					pronouns: null,
					color: null,
				},
			});

			expect(updated).toBe(true);
			const channelMessages = ChannelMessages.get(channelId);
			const msg = channelMessages?.get(messageId);
			expect(msg?.subprofile?.name).toBe('Snapshot Updated');
			expect(msg?.subprofile?.avatar).toBe('new_snapshot_avatar');
		});
	});
});
