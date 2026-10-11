// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import {createOptimisticMessage, prepareMessageReference} from '@app/features/messaging/utils/MessageSubmitUtils';
import {User} from '@app/features/user/models/User';
import {MessageStates, MessageTypes} from '@fluxer/constants/src/ChannelConstants';

describe('MessageSubmitUtils', () => {
	const mockCurrentUser = new User({
		id: '1546500000000000001',
		username: 'alice',
		discriminator: '0001',
		avatar: null,
		flags: 0,
	} as any);

	describe('createOptimisticMessage', () => {
		it('creates default optimistic message without subprofile', () => {
			const msg = createOptimisticMessage(
				{
					content: 'Hello world',
					channelId: 'channel_123',
					nonce: 'nonce_456',
					currentUser: mockCurrentUser,
				},
				[],
			);

			expect(msg.id).toBe('nonce_456');
			expect(msg.channelId).toBe('channel_123');
			expect(msg.content).toBe('Hello world');
			expect(msg.state).toBe(MessageStates.SENDING);
			expect(msg.type).toBe(MessageTypes.DEFAULT);
			expect(msg.subprofile).toBeNull();
		});

		it('populates subprofile metadata when provided', () => {
			const msg = createOptimisticMessage(
				{
					content: 'Persona message',
					channelId: 'channel_123',
					nonce: 'nonce_789',
					currentUser: mockCurrentUser,
					subprofile: {
						id: 'persona_1',
						name: 'Fox Persona',
						avatar: 'https://example.com/fox.png',
						avatar_color: 0xff0000,
						display_tag_text: 'VIXEN',
						display_tag_icon: '🦊',
						pronouns: 'she/they',
						color: 0xffa500,
						bio: 'Clever fox',
						visibility: 'public',
					},
				},
				[],
			);

			expect(msg.subprofile).toBeDefined();
			expect(msg.subprofile?.id).toBe('persona_1');
			expect(msg.subprofile?.name).toBe('Fox Persona');
			expect(msg.subprofile?.avatar).toBe('https://example.com/fox.png');
			expect(msg.subprofile?.display_tag_text).toBe('VIXEN');
			expect(msg.subprofile?.display_tag_icon).toBe('🦊');
			expect(msg.subprofile?.pronouns).toBe('she/they');
			expect(msg.subprofile?.color).toBe(0xffa500);
			expect(msg.subprofile?.visibility).toBe('public');
		});

		it('handles referenced messages correctly', () => {
			const refMsg = createOptimisticMessage(
				{
					content: 'Parent message',
					channelId: 'channel_123',
					nonce: 'parent_111',
					currentUser: mockCurrentUser,
				},
				[],
			);

			const replyMsg = createOptimisticMessage(
				{
					content: 'Child reply',
					channelId: 'channel_123',
					nonce: 'reply_222',
					currentUser: mockCurrentUser,
					referencedMessage: refMsg,
					replyMentioning: true,
				},
				[],
			);

			expect(replyMsg.type).toBe(MessageTypes.REPLY);
			expect(replyMsg.messageReference).toEqual({
				channel_id: 'channel_123',
				message_id: 'parent_111',
				type: 0,
			});
		});
	});

	describe('prepareMessageReference', () => {
		it('returns undefined if no referenced message', () => {
			expect(prepareMessageReference('ch_1', null)).toBeUndefined();
			expect(prepareMessageReference('ch_1', undefined)).toBeUndefined();
		});

		it('returns MessageReference if referenced message exists', () => {
			const refMsg = createOptimisticMessage(
				{
					content: 'Parent',
					channelId: 'ch_1',
					nonce: 'msg_999',
					currentUser: mockCurrentUser,
				},
				[],
			);
			expect(prepareMessageReference('ch_1', refMsg)).toEqual({
				channel_id: 'ch_1',
				message_id: 'msg_999',
				type: 0,
			});
		});
	});
});
