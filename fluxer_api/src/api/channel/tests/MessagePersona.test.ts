// SPDX-License-Identifier: AGPL-3.0-or-later

import {MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import {
	MessageRequestSchema,
	MessageUpdateRequestSchema,
} from '@fluxer/schema/src/domains/message/MessageRequestSchemas';
import {MessageResponseSchema} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {INatsConnectionManager} from '@pkgs/nats/src/INatsConnectionManager';
import type {NatsConnection} from 'nats';
import {describe, expect, it} from 'vitest';
import {createChannelID, createGuildID, createMessageID, createUserID} from '../../BrandedTypes';
import {Message} from '../../models/Message';
import {MessageResponseDataService} from '../services/message/MessageResponseDataService';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeConnectionManager implements INatsConnectionManager {
	readonly payloads: Array<Record<string, unknown>> = [];

	async connect(): Promise<void> {}
	async drain(): Promise<void> {}
	isClosed(): boolean {
		return false;
	}

	getConnection(): NatsConnection {
		return {
			request: async (_subject: string, data: Uint8Array) => {
				const payload = JSON.parse(decoder.decode(data)) as Record<string, unknown>;
				this.payloads.push(payload);
				if (payload.op === 'BuildResponses') {
					const messages = payload.messages as Array<Record<string, unknown>>;
					return {
						data: encoder.encode(
							JSON.stringify({
								FoundApiMany: messages.map((m) => ({
									id: String(m.message_id),
									channel_id: String(m.channel_id),
									author: {id: '3', username: 'author', discriminator: '0001', avatar: null, flags: 0},
									type: MessageTypes.DEFAULT,
									flags: 0,
									content: m.content ?? '',
									timestamp: '2026-01-01T00:00:00.000Z',
									edited_timestamp: null,
									pinned: false,
									mention_everyone: false,
									tts: false,
									mentions: [],
									mention_roles: [],
									embeds: [],
									attachments: [],
									stickers: [],
									subprofile: m.subprofile ?? null,
								})),
							}),
						),
					};
				}
				return {
					data: encoder.encode(JSON.stringify({FoundApi: {id: '2', channel_id: '1'}})),
				};
			},
		} as unknown as NatsConnection;
	}
}

describe('MessagePersona Backend Pipeline', () => {
	it('validates MessageRequest with subprofile', () => {
		const parsed = MessageRequestSchema.safeParse({
			content: 'Hello from Alice',
			subprofile: {
				id: 'persona-1',
				name: 'Alice',
				avatar: 'https://example.com/alice.png',
				display_tag_text: 'Wonderland',
				display_tag_icon: 'https://example.com/icon.png',
				system_name: 'The System',
				pronouns: 'she/her',
				color: 0xff0000,
			},
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.subprofile?.name).toBe('Alice');
			expect(parsed.data.subprofile?.display_tag_text).toBe('Wonderland');
			expect(parsed.data.subprofile?.display_tag_icon).toBe('https://example.com/icon.png');
			expect(parsed.data.subprofile?.system_name).toBe('The System');
		}
	});

	it('validates MessageUpdateRequest with subprofile', () => {
		const parsed = MessageUpdateRequestSchema.safeParse({
			content: 'Updated content from Bob',
			subprofile: {
				id: 'persona-2',
				name: 'Bob',
				avatar: 'https://example.com/bob.png',
				system_name: 'The System',
				pronouns: 'he/him',
				color: 0x0000ff,
			},
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.subprofile?.name).toBe('Bob');
		}

		// Also allows clearing subprofile with null
		const cleared = MessageUpdateRequestSchema.safeParse({
			content: 'Reverted to root',
			subprofile: null,
		});
		expect(cleared.success).toBe(true);
		if (cleared.success) {
			expect(cleared.data.subprofile).toBeNull();
		}
	});

	it('validates MessageResponse with subprofile', () => {
		const parsed = MessageResponseSchema.safeParse({
			id: '1546500000000000000',
			channel_id: '1546500000000000001',
			author: {
				id: '1546500000000000002',
				username: 'root_user',
				discriminator: '0001',
				global_name: null,
				avatar: null,
				avatar_color: null,
				flags: 0,
			},
			type: MessageTypes.DEFAULT,
			flags: 0,
			content: 'Hello from Bob',
			timestamp: '2026-01-01T00:00:00.000Z',
			pinned: false,
			mention_everyone: false,
			tts: false,
			mentions: [],
			mention_roles: [],
			subprofile: {
				id: 'persona-2',
				name: 'Bob',
				avatar: null,
				system_name: 'The System',
				pronouns: 'he/him',
				color: 0x0000ff,
				bio: 'Bob bio',
			},
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.subprofile?.name).toBe('Bob');
			expect(parsed.data.author.username).toBe('root_user');
		}
	});

	it('persists and serializes subprofile on Message model', () => {
		const message = new Message({
			channel_id: createChannelID(10n),
			bucket: 0,
			message_id: createMessageID(20n),
			author_id: createUserID(30n),
			type: MessageTypes.DEFAULT,
			webhook_id: null,
			webhook_name: null,
			webhook_avatar_hash: null,
			content: 'Proxied text',
			edited_timestamp: null,
			pinned_timestamp: null,
			flags: 0,
			mention_everyone: false,
			mention_users: null,
			mention_roles: null,
			mention_channels: null,
			attachments: null,
			embeds: null,
			sticker_items: null,
			message_reference: null,
			message_snapshots: null,
			call: null,
			has_reaction: null,
			version: 1,
			subprofile: {
				id: 'persona-alice',
				name: 'Alice',
				avatar: 'avatar-hash',
				system_name: 'Sys',
				pronouns: 'she/her',
				color: 12345,
			},
		});

		expect(message.subprofile).toEqual({
			id: 'persona-alice',
			name: 'Alice',
			avatar: 'avatar-hash',
			system_name: 'Sys',
			pronouns: 'she/her',
			color: 12345,
		});

		const row = message.toRow();
		expect(row.subprofile?.name).toBe('Alice');
	});

	it('forwards subprofile to NATS svc.messages in buildMessages', async () => {
		const fakeManager = new FakeConnectionManager();
		const service = new MessageResponseDataService(fakeManager);

		const message = new Message({
			channel_id: createChannelID(10n),
			bucket: 0,
			message_id: createMessageID(20n),
			author_id: createUserID(30n),
			type: MessageTypes.DEFAULT,
			webhook_id: null,
			webhook_name: null,
			webhook_avatar_hash: null,
			content: 'Hello!',
			edited_timestamp: null,
			pinned_timestamp: null,
			flags: 0,
			mention_everyone: false,
			mention_users: null,
			mention_roles: null,
			mention_channels: null,
			attachments: null,
			embeds: null,
			sticker_items: null,
			message_reference: null,
			message_snapshots: null,
			call: null,
			has_reaction: null,
			version: 1,
			subprofile: {
				id: 'persona-alice',
				name: 'Alice',
			},
		});

		const results = await service.buildMessages({
			userId: createUserID(30n),
			messages: [message],
			access: {sourceGuildId: createGuildID(1n), messageHistoryCutoff: null, canReadMessageHistory: true},
		});

		expect(results).toHaveLength(1);
		expect(results[0].subprofile).toEqual({
			id: 'persona-alice',
			name: 'Alice',
		});

		expect(fakeManager.payloads).toHaveLength(1);
		const sentMessages = fakeManager.payloads[0].messages as Array<Record<string, unknown>>;
		expect(sentMessages[0].subprofile).toEqual({
			id: 'persona-alice',
			name: 'Alice',
		});
	});
});
