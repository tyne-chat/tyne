// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import type {MessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as MessageCommands from '../commands/MessageCommands';
import type {Message} from '../models/MessagingMessage';
import MessageChangePersona from './MessageChangePersona';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('../commands/MessageCommands', () => ({
	edit: vi.fn().mockResolvedValue(null),
}));

describe('MessageChangePersona', () => {
	const channelId = '1000000000000000001';
	const messageId = '2000000000000000002';
	const otherMessageId = '2000000000000000003';

	afterEach(() => {
		MessageChangePersona.stopChangingPersona(channelId, messageId);
		MessageChangePersona.stopChangingPersona(channelId, otherMessageId);
		vi.clearAllMocks();
	});

	describe('state management', () => {
		it('initially reports no persona edit in progress', () => {
			expect(MessageChangePersona.isChangingPersona(channelId, messageId)).toBe(false);
		});

		it('tracks persona edit state when started', () => {
			MessageChangePersona.startChangePersona(channelId, messageId);
			expect(MessageChangePersona.isChangingPersona(channelId, messageId)).toBe(true);
			expect(MessageChangePersona.isChangingPersona(channelId, otherMessageId)).toBe(false);
			expect(MessageChangePersona.isChangingPersona('different-channel', messageId)).toBe(false);
		});

		it('stops tracking persona edit state when stopped with matching IDs', () => {
			MessageChangePersona.startChangePersona(channelId, messageId);
			expect(MessageChangePersona.isChangingPersona(channelId, messageId)).toBe(true);

			MessageChangePersona.stopChangingPersona(channelId, messageId);
			expect(MessageChangePersona.isChangingPersona(channelId, messageId)).toBe(false);
		});

		it('does not stop tracking if channel or message ID does not match', () => {
			MessageChangePersona.startChangePersona(channelId, messageId);

			MessageChangePersona.stopChangingPersona(channelId, otherMessageId);
			expect(MessageChangePersona.isChangingPersona(channelId, messageId)).toBe(true);

			MessageChangePersona.stopChangingPersona('different-channel', messageId);
			expect(MessageChangePersona.isChangingPersona(channelId, messageId)).toBe(true);
		});
	});

	describe('MobX reaction subscribe', () => {
		it('invokes callback immediately upon subscription', () => {
			const callback = vi.fn();
			const dispose = MessageChangePersona.subscribe(callback);

			expect(callback).toHaveBeenCalledTimes(1);
			dispose();
		});

		it('invokes callback when editing state changes', () => {
			const callback = vi.fn();
			const dispose = MessageChangePersona.subscribe(callback);
			expect(callback).toHaveBeenCalledTimes(1);

			MessageChangePersona.startChangePersona(channelId, messageId);
			expect(callback).toHaveBeenCalledTimes(2);

			MessageChangePersona.stopChangingPersona(channelId, messageId);
			expect(callback).toHaveBeenCalledTimes(3);

			dispose();
		});

		it('stops invoking callback after disposer is called', () => {
			const callback = vi.fn();
			const dispose = MessageChangePersona.subscribe(callback);
			expect(callback).toHaveBeenCalledTimes(1);

			dispose();

			MessageChangePersona.startChangePersona(channelId, messageId);
			expect(callback).toHaveBeenCalledTimes(1);
		});
	});

	describe('changePersona command execution', () => {
		const mockChannel = {id: channelId} as unknown as Channel;

		it('delegates persona change to MessageCommands.edit with subprofile payload', async () => {
			const mockMessage = {
				id: messageId,
				content: 'Hello world',
				_allowedMentions: undefined,
				attachments: [],
			} as unknown as Message;

			const subprofilePayload: MessageSubprofileRequest = {
				id: 'persona-123',
				name: 'Test Persona',
			};

			await MessageChangePersona.changePersona(mockChannel, mockMessage, subprofilePayload);

			expect(MessageCommands.edit).toHaveBeenCalledTimes(1);
			expect(MessageCommands.edit).toHaveBeenCalledWith(
				channelId,
				messageId,
				undefined,
				undefined,
				undefined,
				undefined,
				subprofilePayload,
			);
		});

		it('passes existing attachment references when message has attachments', async () => {
			const mockMessage = {
				id: messageId,
				content: 'Look at this picture',
				_allowedMentions: undefined,
				attachments: [{id: 'att-1'}, {id: 'att-2'}],
			} as unknown as Message;

			await MessageChangePersona.changePersona(mockChannel, mockMessage, null);

			expect(MessageCommands.edit).toHaveBeenCalledWith(
				channelId,
				messageId,
				undefined,
				undefined,
				undefined,
				[{id: 'att-1'}, {id: 'att-2'}],
				null,
			);
		});
	});

	describe('buildSubprofilePayload regression tests', () => {
		it('includes active displayTagText and displayTagIcon in subprofile payload', () => {
			(PersonaStore as any)._displayTagText = 'TESTING SYSTEM';
			(PersonaStore as any)._displayTagIcon = 'https://example.com/icon.png';

			const payload = MessageChangePersona.buildSubprofilePayload({
				id: 'bob-123',
				name: 'Bob the Fox',
				avatarUrl: 'https://example.com/bob.png',
				color: 123456,
				bio: 'Fox bio',
				pronouns: 'he/him',
			});

			expect(payload).toEqual({
				id: 'bob-123',
				name: 'Bob the Fox',
				avatar: 'https://example.com/bob.png',
				avatar_color: 123456,
				color: 123456,
				display_tag_text: 'TESTING SYSTEM',
				display_tag_icon: 'https://example.com/icon.png',
				system_name: 'TESTING SYSTEM',
				bio: 'Fox bio',
				pronouns: 'he/him',
			});
		});

		it('defaults display tags to null when not configured', () => {
			(PersonaStore as any)._displayTagText = '';
			(PersonaStore as any)._displayTagIcon = '';

			const payload = MessageChangePersona.buildSubprofilePayload({
				id: 'bob-123',
				name: 'Bob the Fox',
			});

			expect(payload.display_tag_text).toBeNull();
			expect(payload.display_tag_icon).toBeNull();
			expect(payload.system_name).toBeNull();
		});
	});
});
