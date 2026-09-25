// SPDX-License-Identifier: AGPL-3.0-or-later

import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {retryFailedMessage} from './MessageRetryUtils';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('@app/features/messaging/commands/MessageCommands', () => ({
	retryLocal: vi.fn(),
	createOptimistic: vi.fn(),
	send: vi.fn(),
}));

vi.mock('@app/features/messaging/upload/CloudUpload', () => ({
	CloudUpload: {
		getMessageUpload: vi.fn().mockReturnValue(null),
	},
}));

describe('MessageRetryUtils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns false if message has no nonce', () => {
		const message = {
			nonce: null,
		} as unknown as Message;

		expect(retryFailedMessage(message)).toBe(false);
		expect(MessageCommands.send).not.toHaveBeenCalled();
	});

	it('retries message without subprofile when message had no persona', () => {
		const recordUseSpy = vi.spyOn(PersonaStore, 'recordPersonaUse');
		const message = {
			id: 'msg-1',
			channelId: 'chan-1',
			nonce: 'nonce-123',
			content: 'Hello world',
			flags: 0,
			attachments: [],
			stickers: [],
			subprofile: null,
			toJSON: () => ({
				id: 'msg-1',
				channel_id: 'chan-1',
				nonce: 'nonce-123',
				content: 'Hello world',
				attachments: [],
				subprofile: null,
			}),
		} as unknown as Message;

		expect(retryFailedMessage(message)).toBe(true);
		expect(MessageCommands.send).toHaveBeenCalledWith(
			'chan-1',
			expect.objectContaining({
				content: 'Hello world',
				nonce: 'nonce-123',
				subprofile: undefined,
			}),
		);
		expect(recordUseSpy).not.toHaveBeenCalled();
	});

	it('retries message with subprofile and records usage when message had a persona', () => {
		const recordUseSpy = vi.spyOn(PersonaStore, 'recordPersonaUse').mockResolvedValue();
		const mockSubprofile = {
			id: 'persona-123',
			name: 'Alice',
			avatar: 'https://example.com/alice.png',
			avatar_color: 0x123456,
			color: 0x123456,
			display_tag_text: 'SYS',
			display_tag_icon: null,
			system_name: 'SYS',
			pronouns: 'she/her',
			bio: null,
			visibility: 'unlisted' as const,
		};
		const message = {
			id: 'msg-2',
			channelId: 'chan-1',
			nonce: 'nonce-456',
			content: 'Message from Alice',
			flags: 0,
			attachments: [],
			stickers: [],
			subprofile: mockSubprofile,
			toJSON: () => ({
				id: 'msg-2',
				channel_id: 'chan-1',
				nonce: 'nonce-456',
				content: 'Message from Alice',
				attachments: [],
				subprofile: mockSubprofile,
			}),
		} as unknown as Message;

		expect(retryFailedMessage(message)).toBe(true);
		expect(recordUseSpy).toHaveBeenCalledWith('persona-123');
		expect(MessageCommands.createOptimistic).toHaveBeenCalledWith(
			'chan-1',
			expect.objectContaining({
				subprofile: mockSubprofile,
			}),
		);
		expect(MessageCommands.send).toHaveBeenCalledWith(
			'chan-1',
			expect.objectContaining({
				content: 'Message from Alice',
				nonce: 'nonce-456',
				subprofile: mockSubprofile,
			}),
		);
	});
});
