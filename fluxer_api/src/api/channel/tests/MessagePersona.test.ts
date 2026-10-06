import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {ensureSessionStarted, getMessages} from '@app/api/message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import {DELETED_USER_USERNAME} from '@fluxer/constants/src/UserConstants';
import {
	MessageRequestSchema,
	MessageUpdateRequestSchema,
} from '@fluxer/schema/src/domains/message/MessageRequestSchemas';
import {type MessageResponse, MessageResponseSchema} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {NatsConnection} from '@nats-io/transport-node';
import type {INatsConnectionManager} from '@pkgs/nats/src/INatsConnectionManager';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createChannelID, createGuildID, createMessageID, createPersonaID, createUserID} from '../../BrandedTypes';
import {Message} from '../../models/Message';
import {Persona} from '../../models/Persona';
import {personaLookupKey} from '../../persona/IPersonaRepository';
import {PersonaRepository} from '../../persona/PersonaRepository';
import {normalizeMessageSubprofile} from '../services/message/MessageHelpers';
import {MessageResponseDataService} from '../services/message/MessageResponseDataService';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeConnectionManager implements INatsConnectionManager {
	readonly payloads: Array<Record<string, unknown>> = [];
	customResponse?: unknown;

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
				if (this.customResponse !== undefined) {
					return {
						data: encoder.encode(JSON.stringify(this.customResponse)),
					};
				}
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
									persona_id: m.persona_id ?? null,
								})),
							}),
						),
					};
				}
				if (payload.op === 'ListResponses') {
					return {
						data: encoder.encode(
							JSON.stringify({
								FoundApiMany: [
									{
										id: '1001',
										channel_id: '500',
										author: {id: '3', username: 'author', discriminator: '0001', avatar: null, flags: 0},
										type: MessageTypes.DEFAULT,
										flags: 0,
										content: 'list message',
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
										persona_id: null,
									},
								],
							}),
						),
					};
				}
				if (payload.op === 'GetResponseById') {
					return {
						data: encoder.encode(
							JSON.stringify({
								FoundApi: {
									id: '1002',
									channel_id: '500',
									author: {id: '3', username: 'author', discriminator: '0001', avatar: null, flags: 0},
									type: MessageTypes.DEFAULT,
									flags: 0,
									content: 'single message',
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
									persona_id: null,
								},
							}),
						),
					};
				}
				if (payload.op === 'ExtractMentions') {
					const contents = payload.contents as Array<string>;
					return {
						data: encoder.encode(
							JSON.stringify({
								FoundMentions: contents.map((c) => {
									const userMatches = [...c.matchAll(/<@!?(\d+)(?::[a-zA-Z0-9_-]+)?>/g)].map((m) => m[1]);
									return {
										users: userMatches,
										roles: [],
										channels: [],
										everyone: false,
										here: false,
									};
								}),
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
				pronouns: 'she/her',
				color: 0xff0000,
			},
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.subprofile?.name).toBe('Alice');
			expect(parsed.data.subprofile?.display_tag_text).toBe('Wonderland');
			expect(parsed.data.subprofile?.display_tag_icon).toBe('https://example.com/icon.png');
		}
	});

	it('validates MessageUpdateRequest with subprofile', () => {
		const parsed = MessageUpdateRequestSchema.safeParse({
			content: 'Updated content from Bob',
			subprofile: {
				id: 'persona-2',
				name: 'Bob',
				avatar: 'https://example.com/bob.png',
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
			persona_id: createPersonaID(12345n),
		});

		expect(message.personaId).toBe(createPersonaID(12345n));
		const row = message.toRow();
		expect(row.persona_id).toBe(createPersonaID(12345n));
	});

	it('forwards persona_id to NATS svc.messages in buildMessages', async () => {
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
			persona_id: createPersonaID(12345n),
		});

		const results = await service.buildMessages({
			userId: createUserID(30n),
			messages: [message],
			access: {sourceGuildId: createGuildID(1n), messageHistoryCutoff: null, canReadMessageHistory: true},
		});

		expect(results).toHaveLength(1);
		expect(results[0].subprofile).toEqual({
			id: '12345',
			name: 'Unknown Persona',
			avatar: null,
			avatar_color: null,
			display_tag_text: null,
			display_tag_icon: null,
			pronouns: null,
			color: null,
		});

		expect(fakeManager.payloads).toHaveLength(1);
		const sentMessages = fakeManager.payloads[0].messages as Array<Record<string, unknown>>;
		expect(sentMessages[0].persona_id).toBe('12345');
	});

	it('extracts underlying user id from persona mention wire format in extractMentions', async () => {
		const fakeManager = new FakeConnectionManager();
		const service = new MessageResponseDataService(fakeManager);

		const result = await service.extractMentions(['Hello <@1481621807877361924:1550229100331794432> and <@123456>']);

		expect(fakeManager.payloads).toHaveLength(1);
		expect(fakeManager.payloads[0].op).toBe('ExtractMentions');
		expect(fakeManager.payloads[0].contents).toEqual([
			'Hello <@1481621807877361924:1550229100331794432> and <@123456>',
		]);

		expect(result).toHaveLength(1);
		expect(result[0].users).toEqual(['1481621807877361924', '123456']);
	});

	describe('normalizeMessageSubprofile', () => {
		it('returns null for nullish input', () => {
			expect(normalizeMessageSubprofile(null)).toBeNull();
			expect(normalizeMessageSubprofile(undefined)).toBeNull();
		});

		it('normalizes complete subprofile data', () => {
			const input = {
				id: 'p-1',
				name: 'Alice',
				avatar: 'https://example.com/avatar.png',
				avatar_color: 0x123456,
				display_tag_text: 'System Tag',
				display_tag_icon: 'https://example.com/icon.png',
				pronouns: 'she/they',
				color: 0xff0000,
				bio: 'Bio text',
			};
			expect(normalizeMessageSubprofile(input)).toEqual({
				id: 'p-1',
				name: 'Alice',
				avatar: 'https://example.com/avatar.png',
				avatar_color: 0x123456,
				banner: null,
				display_tag_text: 'System Tag',
				display_tag_icon: 'https://example.com/icon.png',
				pronouns: 'she/they',
				color: 0xff0000,
				bio: 'Bio text',
			});
		});

		it('normalizes display_tag_text', () => {
			const tagOnly = normalizeMessageSubprofile({
				id: 'p-1',
				name: 'Alice',
				display_tag_text: 'OnlyTag',
			});
			expect(tagOnly?.display_tag_text).toBe('OnlyTag');
		});
	});
});

describe('Personal Notes Persona Integration', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	it('preserves and dynamically hydrates persona subprofile when sending and retrieving a message in personal notes', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const personalNotesChannelId = account.userId;

		await createBuilder(harness, account.token)
			.patch('/users/@me/personas/settings')
			.body({
				display_tag_text: 'Wonderland',
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		const persona = await createBuilder<{id: string; name: string; avatar_hash: string}>(harness, account.token)
			.post('/users/@me/personas')
			.body({
				name: 'Alice in Notes',
				avatar_hash: 'a11ce0a5',
			})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const subprofile = {
			id: persona.id,
			name: persona.name,
			avatar: persona.avatar_hash,
		};

		const sentMessage = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${personalNotesChannelId}/messages`)
			.body({
				content: 'Note from Alice',
				subprofile,
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(sentMessage.content).toBe('Note from Alice');
		expect(sentMessage.subprofile).toBeDefined();
		expect(sentMessage.subprofile?.id).toBe(persona.id);
		expect(sentMessage.subprofile?.name).toBe('Alice in Notes');
		expect(sentMessage.subprofile?.avatar).toBe(persona.avatar_hash);
		expect(sentMessage.subprofile?.display_tag_text).toBe('Wonderland');

		const messages = await getMessages(harness, account.token, personalNotesChannelId);
		const fetched = messages.find((m) => m.id === sentMessage.id);
		expect(fetched).toBeDefined();
		expect(fetched?.subprofile?.name).toBe('Alice in Notes');
		expect(fetched?.subprofile?.id).toBe(persona.id);

		// Dynamic update verification: update persona name and ensure historical message reflects update
		await createBuilder(harness, account.token)
			.patch(`/users/@me/personas/${persona.id}`)
			.body({
				name: 'Alice Renamed',
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		const updatedMessages = await getMessages(harness, account.token, personalNotesChannelId);
		const fetchedUpdated = updatedMessages.find((m) => m.id === sentMessage.id);
		expect(fetchedUpdated?.subprofile?.name).toBe('Alice Renamed');

		// Verify persona usage was recorded in PersonaRepository
		const repo = new PersonaRepository();
		const refreshed = await repo.findById(createUserID(BigInt(account.userId)), createPersonaID(BigInt(persona.id)));
		expect(refreshed?.useCount).toBeGreaterThanOrEqual(1);
	});

	it('updates persona_id on message edit and records usage', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const personalNotesChannelId = account.userId;

		const persona1 = await createBuilder<{id: string; name: string}>(harness, account.token)
			.post('/users/@me/personas')
			.body({name: 'Persona One'})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const persona2 = await createBuilder<{id: string; name: string}>(harness, account.token)
			.post('/users/@me/personas')
			.body({name: 'Persona Two'})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const sent = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${personalNotesChannelId}/messages`)
			.body({
				content: 'Initial message',
				subprofile: {id: persona1.id, name: persona1.name},
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(sent.subprofile?.id).toBe(persona1.id);

		// Edit message to switch to persona2
		const edited = await createBuilder<MessageResponse>(harness, account.token)
			.patch(`/channels/${personalNotesChannelId}/messages/${sent.id}`)
			.body({
				content: 'Edited message',
				subprofile: {id: persona2.id, name: persona2.name},
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(edited.subprofile?.id).toBe(persona2.id);
		expect(edited.subprofile?.name).toBe('Persona Two');
	});

	it('handles listMessages and getMessage in MessageResponseDataService', async () => {
		const fakeNats = new FakeConnectionManager();
		const service = new MessageResponseDataService(fakeNats);

		const listRes = await service.listMessages({
			userId: createUserID(3n),
			channelId: createChannelID(500n),
			limit: 10,
			access: {canReadMessageHistory: true} as any,
		});
		expect(listRes).toHaveLength(1);
		expect(listRes[0].content).toBe('list message');

		const singleRes = await service.getMessage({
			userId: createUserID(3n),
			channelId: createChannelID(500n),
			messageId: createMessageID(1002n),
			access: {canReadMessageHistory: true} as any,
		});
		expect(singleRes).toBeDefined();
		expect(singleRes?.content).toBe('single message');
	});

	it('hydrates persona on referenced_message in buildMessages and listMessages', async () => {
		const fakeManager = new FakeConnectionManager();
		const mockPersona = new Persona({
			user_id: createUserID(30n),
			persona_id: createPersonaID(999n),
			name: 'Sneaks',
			avatar_hash: 'sneaks_hash',
			banner_hash: null,
			pronouns: 'they/them',
			color: 0x123456,
			avatar_color: null,
			bio: null,
			auto_tag_disabled: false,
			persona_tags: '[]',
			signature_emojis: '[]',
			use_count: 5,
			last_used_at_ms: null,
			visibility: 'public',
			external_uuid: null,
			created_at: new Date(),
			updated_at: new Date(),
			deleted_at: null,
			version: 1,
		});

		const mockRepo = {
			findByUserAndPersonaIds: vi
				.fn()
				.mockImplementation(async (pairs: Array<{userId: unknown; personaId: unknown}>) => {
					const map = new Map<string, Persona>();
					for (const p of pairs) {
						if (String(p.userId) === '30' && String(p.personaId) === '999') {
							map.set(personaLookupKey('30', '999'), mockPersona);
						}
					}
					return map;
				}),
			findSettingsByUserIds: vi.fn().mockResolvedValue(new Map()),
		} as unknown as PersonaRepository;

		const service = new MessageResponseDataService(fakeManager, mockRepo);

		fakeManager.customResponse = {
			FoundApiMany: [
				{
					id: '2001',
					channel_id: '500',
					author: {id: '40', username: 'replier', discriminator: '0001', avatar: null, flags: 0},
					type: MessageTypes.DEFAULT,
					flags: 0,
					content: 'reply text',
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
					persona_id: null,
					referenced_message: {
						id: '1001',
						channel_id: '500',
						author: {id: '30', username: 'root_user', discriminator: '0001', avatar: null, flags: 0},
						type: MessageTypes.DEFAULT,
						flags: 0,
						content: 'original text',
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
						persona_id: '999',
					},
				},
			],
		};

		const messages = await service.listMessages({
			userId: createUserID(40n),
			channelId: createChannelID(500n),
			limit: 10,
			access: {canReadMessageHistory: true} as any,
		});

		expect(messages).toHaveLength(1);
		expect(messages[0].subprofile).toBeNull();
		expect(messages[0].referenced_message).toBeDefined();
		expect(messages[0].referenced_message?.subprofile).toEqual(
			expect.objectContaining({
				id: '999',
				name: 'Sneaks',
				pronouns: 'they/them',
				color: 0x123456,
			}),
		);
		expect((messages[0].referenced_message as any).persona_id).toBeUndefined();
	});

	it('hydrates deleted persona and deleted author on referenced_message', async () => {
		const fakeManager = new FakeConnectionManager();
		const mockRepo = {
			findByUserAndPersonaIds: vi.fn().mockResolvedValue(new Map()),
			findSettingsByUserIds: vi.fn().mockResolvedValue(new Map()),
		} as unknown as PersonaRepository;

		const service = new MessageResponseDataService(fakeManager, mockRepo);

		fakeManager.customResponse = {
			FoundApiMany: [
				{
					id: '3001',
					channel_id: '500',
					author: {id: '40', username: 'replier', discriminator: '0001', avatar: null, flags: 0},
					type: MessageTypes.DEFAULT,
					flags: 0,
					content: 'reply to unknown persona',
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
					persona_id: null,
					referenced_message: {
						id: '1002',
						channel_id: '500',
						author: {id: '30', username: 'author', discriminator: '0001', avatar: null, flags: 0},
						type: MessageTypes.DEFAULT,
						flags: 0,
						content: 'msg',
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
						persona_id: '888',
					},
				},
				{
					id: '3002',
					channel_id: '500',
					author: {id: '40', username: 'replier', discriminator: '0001', avatar: null, flags: 0},
					type: MessageTypes.DEFAULT,
					flags: 0,
					content: 'reply to deleted author',
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
					persona_id: null,
					referenced_message: {
						id: '1003',
						channel_id: '500',
						author: {id: '31', username: DELETED_USER_USERNAME, discriminator: '0000', avatar: null, flags: 0},
						type: MessageTypes.DEFAULT,
						flags: 0,
						content: 'msg from deleted user',
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
						persona_id: '777',
					},
				},
			],
		};

		const messages = await service.listMessages({
			userId: createUserID(40n),
			channelId: createChannelID(500n),
			limit: 10,
			access: {canReadMessageHistory: true} as any,
		});

		expect(messages).toHaveLength(2);
		expect(messages[0].referenced_message?.subprofile).toEqual(
			expect.objectContaining({
				id: '888',
				name: 'Unknown Persona',
			}),
		);
		expect(messages[1].referenced_message?.subprofile).toEqual(
			expect.objectContaining({
				id: '777',
				name: 'Deleted Persona',
			}),
		);
	});

	it("rejects sending a message with another member's persona", async () => {
		const {members, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [owner, impostor] = members as [TestAccount, TestAccount];
		await ensureSessionStarted(harness, owner.token);
		await ensureSessionStarted(harness, impostor.token);

		const ownerPersona = await createBuilder<{id: string; name: string}>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Owner Persona'})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const ownerMessage = await createBuilder<MessageResponse>(harness, owner.token)
			.post(`/channels/${systemChannel.id}/messages`)
			.body({content: 'From the real owner', subprofile: {id: ownerPersona.id, name: ownerPersona.name}})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(ownerMessage.subprofile?.name).toBe('Owner Persona');

		await createBuilder(harness, impostor.token)
			.post(`/channels/${systemChannel.id}/messages`)
			.body({content: 'From the impostor', subprofile: {id: ownerPersona.id, name: ownerPersona.name}})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();

		await createBuilder(harness, impostor.token)
			.post(`/channels/${systemChannel.id}/messages`)
			.body({content: 'Bad id', subprofile: {id: 'not-a-snowflake', name: 'Nobody'}})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();

		const messages = await getMessages(harness, impostor.token, systemChannel.id);
		expect(messages.some((m) => m.content === 'From the impostor' || m.content === 'Bad id')).toBe(false);
	});

	it("rejects editing a message onto another member's persona and leaves it unchanged", async () => {
		const {members, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [owner, impostor] = members as [TestAccount, TestAccount];
		await ensureSessionStarted(harness, owner.token);
		await ensureSessionStarted(harness, impostor.token);

		const ownerPersona = await createBuilder<{id: string; name: string}>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Owner Persona'})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const impostorMessage = await createBuilder<MessageResponse>(harness, impostor.token)
			.post(`/channels/${systemChannel.id}/messages`)
			.body({content: 'Plain message'})
			.expect(HTTP_STATUS.OK)
			.execute();

		await createBuilder(harness, impostor.token)
			.patch(`/channels/${systemChannel.id}/messages/${impostorMessage.id}`)
			.body({subprofile: {id: ownerPersona.id, name: ownerPersona.name}})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();

		const messages = await getMessages(harness, owner.token, systemChannel.id);
		const fetched = messages.find((m) => m.id === impostorMessage.id);
		expect(fetched?.subprofile ?? null).toBeNull();
	});

	it('keeps a message editable when it re-sends its own since-deleted persona', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const personalNotesChannelId = account.userId;

		const persona = await createBuilder<{id: string; name: string}>(harness, account.token)
			.post('/users/@me/personas')
			.body({name: 'Short Lived'})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const sent = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${personalNotesChannelId}/messages`)
			.body({content: 'Before deletion', subprofile: {id: persona.id, name: persona.name}})
			.expect(HTTP_STATUS.OK)
			.execute();

		await createBuilder(harness, account.token)
			.delete(`/users/@me/personas/${persona.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		const edited = await createBuilder<MessageResponse>(harness, account.token)
			.patch(`/channels/${personalNotesChannelId}/messages/${sent.id}`)
			.body({content: 'After deletion', subprofile: {id: persona.id, name: persona.name}})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(edited.content).toBe('After deletion');
		expect(edited.subprofile?.id).toBe(persona.id);

		await createBuilder(harness, account.token)
			.post(`/channels/${personalNotesChannelId}/messages`)
			.body({content: 'New message', subprofile: {id: persona.id, name: persona.name}})
			.expect(HTTP_STATUS.NOT_FOUND, 'UNKNOWN_PERSONA')
			.execute();
	});

	it("does not hydrate a stored foreign persona id with the owner's persona from the same batch", async () => {
		const fakeManager = new FakeConnectionManager();
		const ownerPersona = new Persona({
			user_id: createUserID(30n),
			persona_id: createPersonaID(999n),
			name: 'Sneaks',
			avatar_hash: 'sneaks_hash',
			banner_hash: null,
			pronouns: null,
			color: null,
			avatar_color: null,
			bio: null,
			auto_tag_disabled: false,
			persona_tags: '[]',
			signature_emojis: '[]',
			use_count: 0,
			last_used_at_ms: null,
			visibility: 'public',
			external_uuid: null,
			created_at: new Date(),
			updated_at: new Date(),
			deleted_at: null,
			version: 1,
		});
		const mockRepo = {
			findByUserAndPersonaIds: vi
				.fn()
				.mockImplementation(async (pairs: Array<{userId: unknown; personaId: unknown}>) => {
					const map = new Map<string, Persona>();
					for (const p of pairs) {
						if (String(p.userId) === '30' && String(p.personaId) === '999') {
							map.set(personaLookupKey('30', '999'), ownerPersona);
						}
					}
					return map;
				}),
			findSettingsByUserIds: vi.fn().mockResolvedValue(new Map()),
		} as unknown as PersonaRepository;
		const service = new MessageResponseDataService(fakeManager, mockRepo);
		const baseMessage = {
			channel_id: '500',
			type: MessageTypes.DEFAULT,
			flags: 0,
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
			persona_id: '999',
		};
		fakeManager.customResponse = {
			FoundApiMany: [
				{
					...baseMessage,
					id: '3001',
					author: {id: '30', username: 'owner', discriminator: '0001', avatar: null, flags: 0},
					content: 'real',
				},
				{
					...baseMessage,
					id: '3002',
					author: {id: '40', username: 'impostor', discriminator: '0001', avatar: null, flags: 0},
					content: 'forged',
				},
			],
		};

		const messages = await service.listMessages({
			userId: createUserID(40n),
			channelId: createChannelID(500n),
			limit: 10,
			access: {canReadMessageHistory: true} as any,
		});

		const real = messages.find((m) => m.id === '3001');
		const forged = messages.find((m) => m.id === '3002');
		expect(real?.subprofile?.name).toBe('Sneaks');
		expect(forged?.subprofile?.name).toBe('Unknown Persona');
		expect(forged?.subprofile?.avatar).toBeNull();
	});
});
