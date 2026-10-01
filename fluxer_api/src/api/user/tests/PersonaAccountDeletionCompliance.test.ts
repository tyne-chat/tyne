// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	createChannelID,
	createMessageID,
	createPersonaID,
	createUserID,
	type PersonaID,
	type UserID,
} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import {MessageResponseDataService} from '@app/api/channel/services/message/MessageResponseDataService';
import {Persona} from '@app/api/models/Persona';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';
import {processUserDeletion} from '@app/api/user/services/UserDeletionService';
import {MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import {DELETED_USER_DISCRIMINATOR, DELETED_USER_USERNAME, UserFlags} from '@fluxer/constants/src/UserConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {INatsConnectionManager} from '@pkgs/nats/src/INatsConnectionManager';
import {describe, expect, it, vi} from 'vitest';

class ExposedMessageResponseDataService extends MessageResponseDataService {
	public async runHydratePersonas(messages: Array<MessageResponse>): Promise<void> {
		return this.hydratePersonas(messages);
	}
}

const mockNatsManager: INatsConnectionManager = {
	async connect() {},
	async drain() {},
	isClosed() {
		return false;
	},
	getConnection(): any {
		return {};
	},
};

describe('Persona Account Deletion Compliance', () => {
	describe('Read-time message hydration (MessageResponseDataService)', () => {
		it('renders Deleted Persona with anonymous ID for messages from deleted authors with persona_id', async () => {
			const anonPersonaId = '2000000000000000001';
			const service = new ExposedMessageResponseDataService(mockNatsManager);

			const msg = {
				id: '1000000000000000001',
				channel_id: '500',
				author: {
					id: '999',
					username: DELETED_USER_USERNAME,
					discriminator: DELETED_USER_DISCRIMINATOR,
					avatar: null,
					flags: UserFlags.DELETED,
				},
				type: MessageTypes.DEFAULT,
				flags: 0,
				content: 'Message from headmate 1',
				timestamp: '2026-01-01T00:00:00.000Z',
				edited_timestamp: null,
				pinned: false,
				mention_everyone: false,
				tts: false,
				mentions: [],
				mention_roles: [],
				embeds: [],
				attachments: [],
				persona_id: anonPersonaId,
			} as unknown as MessageResponse;

			await service.runHydratePersonas([msg]);

			expect(msg.subprofile).toEqual({
				id: anonPersonaId,
				name: 'Deleted Persona',
				avatar: null,
				avatar_color: null,
				pronouns: null,
				color: null,
				display_tag_text: null,
				display_tag_icon: null,
			});
			expect((msg as any).persona_id).toBeUndefined();
		});

		it('renders subprofile = null for messages from deleted authors without persona_id', async () => {
			const service = new ExposedMessageResponseDataService(mockNatsManager);

			const msg = {
				id: '1000000000000000002',
				channel_id: '500',
				author: {
					id: '999',
					username: DELETED_USER_USERNAME,
					discriminator: DELETED_USER_DISCRIMINATOR,
					avatar: null,
					flags: UserFlags.DELETED,
				},
				type: MessageTypes.DEFAULT,
				flags: 0,
				content: 'Message without persona',
				timestamp: '2026-01-01T00:00:00.000Z',
				edited_timestamp: null,
				pinned: false,
				mention_everyone: false,
				tts: false,
				mentions: [],
				mention_roles: [],
				embeds: [],
				attachments: [],
			} as unknown as MessageResponse;

			await service.runHydratePersonas([msg]);

			expect(msg.subprofile).toBeNull();
			expect((msg as any).persona_id).toBeUndefined();
		});

		it('preserves distinction between two different headmates under the same deleted author', async () => {
			const anonPersonaA = '2000000000000000001';
			const anonPersonaB = '2000000000000000002';
			const service = new ExposedMessageResponseDataService(mockNatsManager);

			const msgA = {
				id: '101',
				channel_id: '500',
				author: {
					id: '999',
					username: DELETED_USER_USERNAME,
					flags: UserFlags.DELETED,
				},
				content: 'Msg A',
				persona_id: anonPersonaA,
			} as unknown as MessageResponse;

			const msgB = {
				id: '102',
				channel_id: '500',
				author: {
					id: '999',
					username: DELETED_USER_USERNAME,
					flags: UserFlags.DELETED,
				},
				content: 'Msg B',
				persona_id: anonPersonaB,
			} as unknown as MessageResponse;

			await service.runHydratePersonas([msgA, msgB]);

			expect(msgA.subprofile?.id).toBe(anonPersonaA);
			expect(msgA.subprofile?.name).toBe('Deleted Persona');
			expect(msgB.subprofile?.id).toBe(anonPersonaB);
			expect(msgB.subprofile?.name).toBe('Deleted Persona');
			// Distinct topology is maintained:
			expect(msgA.subprofile?.id).not.toBe(msgB.subprofile?.id);
		});

		it('handles messages with null author, non-numeric author ID, or deleted author without username match', async () => {
			const service = new ExposedMessageResponseDataService(mockNatsManager);

			const msgNullAuthor = {
				id: '103',
				channel_id: '500',
				author: null,
				persona_id: '2000000000000000001',
			} as unknown as MessageResponse;

			const msgNonNumericAuthor = {
				id: '104',
				channel_id: '500',
				author: {
					id: 'not_numeric',
					username: 'User',
					flags: 0,
				},
				persona_id: '2000000000000000001',
			} as unknown as MessageResponse;

			const msgDeletedFlagOnly = {
				id: '105',
				channel_id: '500',
				author: {
					id: '999',
					username: 'OriginalName',
					flags: UserFlags.DELETED,
				},
				persona_id: '2000000000000000001',
			} as unknown as MessageResponse;

			await service.runHydratePersonas([msgNullAuthor, msgNonNumericAuthor, msgDeletedFlagOnly]);

			expect(msgNullAuthor.subprofile).toBeNull();
			expect((msgNullAuthor as any).persona_id).toBeUndefined();

			expect(msgNonNumericAuthor.subprofile).toBeNull();
			expect((msgNonNumericAuthor as any).persona_id).toBeUndefined();

			expect(msgDeletedFlagOnly.subprofile?.name).toBe('Deleted Persona');
		});
	});

	describe('Full account deletion orchestration (UserDeletionService.processUserDeletion)', () => {
		it('mints anonymous persona snowflakes, re-attributes messages, surgically deletes CDN media, and hard-deletes original personas', async () => {
			const userId = createUserID(1111111111111111111n);
			const deletedUserId = createUserID(9999999999999999999n);
			const anonPersonaId1 = createPersonaID(8888888888888888881n);
			const anonPersonaId2 = createPersonaID(8888888888888888882n);

			const originalPersonaId1 = createPersonaID(2222222222222222221n);
			const originalPersonaId2 = createPersonaID(2222222222222222222n);

			const scheduledAt = new Date('2026-09-01T00:00:00.000Z');

			const persona1 = new Persona({
				user_id: userId,
				persona_id: originalPersonaId1,
				name: 'Alice',
				avatar_hash: 'a_avatar1',
				banner_hash: 'a_banner1',
				pronouns: 'she/her',
				color: 0xff0000,
				avatar_color: null,
				bio: 'Original bio',
				auto_tag_disabled: false,
				persona_tags: '[]',
				use_count: 5,
				last_used_at_ms: null,
				visibility: 'public',
				external_uuid: 'pk-uuid-1',
				created_at: new Date(),
				updated_at: new Date(),
				version: 1,
			});

			const persona2 = new Persona({
				user_id: userId,
				persona_id: originalPersonaId2,
				name: 'Bob',
				avatar_hash: null,
				banner_hash: null,
				pronouns: 'he/him',
				color: null,
				avatar_color: null,
				bio: null,
				auto_tag_disabled: false,
				persona_tags: '[]',
				use_count: 2,
				last_used_at_ms: null,
				visibility: 'unlisted',
				external_uuid: null,
				created_at: new Date(),
				updated_at: new Date(),
				deleted_at: new Date(), // Soft-deleted previously
				version: 2,
			});

			const persona3 = new Persona({
				user_id: userId,
				persona_id: createPersonaID(3333333333333333333n),
				name: 'Error Persona',
				avatar_hash: 'error_avatar',
				banner_hash: 'error_banner',
				pronouns: null,
				color: null,
				avatar_color: null,
				bio: null,
				auto_tag_disabled: false,
				persona_tags: '[]',
				use_count: 0,
				last_used_at_ms: null,
				visibility: 'unlisted',
				external_uuid: null,
				created_at: new Date(),
				updated_at: new Date(),
				version: 1,
			});

			const persona4 = new Persona({
				user_id: userId,
				persona_id: createPersonaID(4444444444444444444n),
				name: 'Static Persona',
				avatar_hash: 'static_avatar4',
				banner_hash: 'static_banner4',
				pronouns: 'they/them',
				color: null,
				avatar_color: null,
				bio: null,
				auto_tag_disabled: false,
				persona_tags: '[]',
				use_count: 1,
				last_used_at_ms: null,
				visibility: 'unlisted',
				external_uuid: null,
				created_at: new Date(),
				updated_at: new Date(),
				version: 1,
			});

			const tombstonesCreated: Array<{userId: UserID; personaId: PersonaID}> = [];
			const anonymizedMessages: Array<{
				channelId: any;
				messageId: any;
				newAuthorId: UserID;
				mapping?: ReadonlyMap<string, PersonaID>;
			}> = [];
			const deletedAvatars: Array<{prefix: string; key: string}> = [];
			const purgedUrls: Array<string> = [];
			let hardDeletedUserId: UserID | null = null;
			let deletedSettingsUserId: UserID | null = null;

			const mockPersonaRepo: IPersonaRepository = {
				findByUserId: vi.fn().mockResolvedValue([persona1, persona2, persona3, persona4]),
				createTombstone: vi.fn().mockImplementation(async (uid: UserID, pid: PersonaID) => {
					tombstonesCreated.push({userId: uid, personaId: pid});
					return {} as Persona;
				}),
				hardDeleteAllByUserId: vi.fn().mockImplementation(async (uid: UserID) => {
					hardDeletedUserId = uid;
				}),
				deleteSettings: vi.fn().mockImplementation(async (uid: UserID) => {
					deletedSettingsUserId = uid;
				}),
				count: vi.fn().mockResolvedValue(3),
				findById: vi.fn().mockResolvedValue(null),
				findByUserIds: vi.fn().mockResolvedValue([]),
				findByUserAndPersonaIds: vi.fn().mockResolvedValue(new Map()),
				create: vi.fn(),
				update: vi.fn(),
				delete: vi.fn(),
				deleteAllByUserId: vi.fn(),
				findSettings: vi.fn().mockResolvedValue(null),
				findSettingsByUserIds: vi.fn().mockResolvedValue(new Map()),
				upsertSettings: vi.fn().mockResolvedValue(undefined as any),
				recordUsage: vi.fn().mockResolvedValue(undefined),
			};

			const mockStorageService = {
				deleteAvatar: vi.fn().mockImplementation(async (params: {prefix: string; key: string}) => {
					if (params.key.includes('error')) {
						throw new Error('Simulated S3 deletion error');
					}
					deletedAvatars.push(params);
				}),
				deleteObject: vi.fn().mockResolvedValue(undefined),
				listObjects: vi.fn().mockResolvedValue([]),
			};

			const mockPurgeQueue = {
				addUrls: vi.fn().mockImplementation(async (urls: Array<string>) => {
					purgedUrls.push(...urls);
				}),
			};

			let snowflakeCount = 0;
			const mockSnowflakeService = {
				generate: vi.fn().mockImplementation(async () => {
					snowflakeCount++;
					if (snowflakeCount === 1) return deletedUserId;
					if (snowflakeCount === 2) return anonPersonaId1;
					if (snowflakeCount === 3) return anonPersonaId2;
					if (snowflakeCount === 4) return createPersonaID(7777777777777777777n);
					return createPersonaID(8888888888888888888n);
				}),
			};

			const mockChannelRepo = {
				messages: {
					listMessagesByAuthor: vi
						.fn()
						.mockResolvedValueOnce([
							{channelId: createChannelID(1n), messageId: createMessageID(101n)},
							{channelId: createChannelID(1n), messageId: createMessageID(102n)},
						])
						.mockResolvedValueOnce([]),
					anonymizeMessage: vi
						.fn()
						.mockImplementation(
							async (chId: any, msgId: any, newAuthor: UserID, mapping?: ReadonlyMap<string, PersonaID>) => {
								anonymizedMessages.push({channelId: chId, messageId: msgId, newAuthorId: newAuthor, mapping});
							},
						),
				},
			};

			const mockUserRepo = {
				getUserGuildIds: vi.fn().mockResolvedValue([]),
				listPrivateChannels: vi.fn().mockResolvedValue([]),
				findUnique: vi.fn().mockResolvedValue({
					id: userId,
					pendingDeletionAt: scheduledAt,
					deletionStartedAt: scheduledAt,
					stripeSubscriptionId: null,
				}),
				startDeletion: vi.fn().mockResolvedValue({
					id: userId,
					avatarHash: 'a_user-avatar-hash',
					bannerHash: 'a_user-banner-hash',
				}),
				create: vi.fn().mockResolvedValue(undefined),
				deleteUserSecondaryIndices: vi.fn().mockResolvedValue(undefined),
				deleteUserSettings: vi.fn().mockResolvedValue(undefined),
				deleteAllUserGuildSettings: vi.fn().mockResolvedValue(undefined),
				deleteAllRelationships: vi.fn().mockResolvedValue(undefined),
				deleteAllNotes: vi.fn().mockResolvedValue(undefined),
				deleteAllReadStates: vi.fn().mockResolvedValue(undefined),
				deleteAllSavedMessages: vi.fn().mockResolvedValue(undefined),
				deleteAllAuthSessions: vi.fn().mockResolvedValue(undefined),
				listAuthSessions: vi.fn().mockResolvedValue([]),
				deleteAuthSessionsByIdHash: vi.fn().mockResolvedValue(undefined),
				deleteAllMfaBackupCodes: vi.fn().mockResolvedValue(undefined),
				deleteAllWebAuthnCredentials: vi.fn().mockResolvedValue(undefined),
				deleteAllPushSubscriptions: vi.fn().mockResolvedValue(undefined),
				deleteAllRecentMentions: vi.fn().mockResolvedValue(undefined),
				deleteAllAuthorizedIps: vi.fn().mockResolvedValue(undefined),
				deletePinnedDmsByUserId: vi.fn().mockResolvedValue(undefined),
				findUniqueAssert: vi.fn().mockResolvedValue({id: userId}),
				anonymizeForDeletion: vi.fn().mockResolvedValue({id: userId}),
				removePendingDeletion: vi.fn().mockResolvedValue(undefined),
				completeDeletion: vi.fn().mockResolvedValue(undefined),
			};

			const mockGuildRepo = {
				listGuildsForUser: vi.fn().mockResolvedValue([]),
				deleteAllBansForUser: vi.fn().mockResolvedValue(undefined),
			};

			const mockConnectionRepo = {
				sealAndDeleteForUser: vi.fn().mockResolvedValue(undefined),
			};

			const mockFavoriteMemeRepo = {
				findByUserId: vi.fn().mockResolvedValue([]),
				deleteAllByUserId: vi.fn().mockResolvedValue(undefined),
			};

			const mockOauthRepo = {
				deleteAllAccessTokensForUser: vi.fn().mockResolvedValue(undefined),
				deleteAllRefreshTokensForUser: vi.fn().mockResolvedValue(undefined),
			};

			const mockAppRepo = {
				listApplicationsByOwner: vi.fn().mockResolvedValue([]),
			};

			const mockWorkerService = {
				addJob: vi.fn().mockResolvedValue(0n),
			};

			const mockUserCacheService = {
				setUserPartialResponseFromUser: vi.fn().mockResolvedValue(undefined),
			};

			const deps: any = {
				userRepository: mockUserRepo,
				guildRepository: mockGuildRepo,
				channelRepository: mockChannelRepo,
				personaRepository: mockPersonaRepo,
				favoriteMemeRepository: mockFavoriteMemeRepo,
				oauth2TokenRepository: mockOauthRepo,
				storageService: mockStorageService,
				purgeQueue: mockPurgeQueue,
				userCacheService: mockUserCacheService,
				gatewayService: {dispatchDirectMessage: vi.fn()},
				snowflakeService: mockSnowflakeService,
				discriminatorService: {releaseDiscriminator: vi.fn()},
				stripe: null,
				applicationRepository: mockAppRepo,
				workerService: mockWorkerService,
				connectionRepository: mockConnectionRepo,
				storeEntitlementService: {stopBillingForDeletedUser: vi.fn()},
			};

			await processUserDeletion(userId, scheduledAt, 1, deps);

			// 1. Personas were fetched with includeDeleted: true
			expect(mockPersonaRepo.findByUserId).toHaveBeenCalledWith(userId, {includeDeleted: true});

			// 2. Tombstones were created under the new deletedUserId for each persona
			expect(tombstonesCreated).toHaveLength(4);
			expect(tombstonesCreated[0]).toEqual({userId: deletedUserId, personaId: anonPersonaId1});
			expect(tombstonesCreated[1]).toEqual({userId: deletedUserId, personaId: anonPersonaId2});

			// 3. Messages were anonymized with the persona ID mapping
			expect(anonymizedMessages).toHaveLength(2);
			expect(anonymizedMessages[0].newAuthorId).toBe(deletedUserId);
			const mapping = anonymizedMessages[0].mapping!;
			expect(mapping.get(originalPersonaId1.toString())).toBe(anonPersonaId1);
			expect(mapping.get(originalPersonaId2.toString())).toBe(anonPersonaId2);

			// 4. Surgical S3 media cleanup was performed for persona1 (hash-based) including rawHash
			expect(deletedAvatars).toContainEqual({
				prefix: 'avatars',
				key: `${userId}/a_avatar1`,
			});
			expect(deletedAvatars).toContainEqual({
				prefix: 'avatars',
				key: `${userId}/avatar1`,
			});
			expect(deletedAvatars).toContainEqual({
				prefix: 'banners',
				key: `${userId}/a_banner1`,
			});
			expect(deletedAvatars).toContainEqual({
				prefix: 'banners',
				key: `${userId}/banner1`,
			});
			// User animated avatar and banner cleanup
			expect(deletedAvatars).toContainEqual({
				prefix: 'avatars',
				key: `${userId}/a_user-avatar-hash`,
			});
			expect(deletedAvatars).toContainEqual({
				prefix: 'avatars',
				key: `${userId}/user-avatar-hash`,
			});
			expect(deletedAvatars).toContainEqual({
				prefix: 'banners',
				key: `${userId}/a_user-banner-hash`,
			});
			expect(deletedAvatars).toContainEqual({
				prefix: 'banners',
				key: `${userId}/user-banner-hash`,
			});
			// persona2 has null hashes, so nothing deleted
			expect(deletedAvatars.some((a) => a.key.includes('bob'))).toBe(false);

			// persona4 (static hash-based without a_ prefix): single deletion each
			expect(deletedAvatars).toContainEqual({
				prefix: 'avatars',
				key: `${userId}/static_avatar4`,
			});
			expect(deletedAvatars).toContainEqual({
				prefix: 'banners',
				key: `${userId}/static_banner4`,
			});

			// persona3 avatar/banner threw S3 deletion errors, yet deletion completed without aborting
			expect(mockStorageService.deleteAvatar).toHaveBeenCalledWith({
				prefix: 'avatars',
				key: `${userId}/error_avatar`,
			});
			expect(mockStorageService.deleteAvatar).toHaveBeenCalledWith({
				prefix: 'banners',
				key: `${userId}/error_banner`,
			});
			expect(deletedAvatars.some((a) => a.key.includes('error'))).toBe(false);

			// Purge queue received CDN URLs
			expect(purgedUrls).toContain(`${Config.endpoints.media}/avatars/${userId}/a_avatar1`);
			expect(purgedUrls).toContain(`${Config.endpoints.media}/avatars/${userId}/avatar1`);
			expect(purgedUrls).toContain(`${Config.endpoints.media}/banners/${userId}/a_banner1`);
			expect(purgedUrls).toContain(`${Config.endpoints.media}/banners/${userId}/banner1`);
			expect(purgedUrls).toContain(`${Config.endpoints.media}/avatars/${userId}/static_avatar4`);
			expect(purgedUrls).toContain(`${Config.endpoints.media}/banners/${userId}/static_banner4`);

			// 5. Hard delete of original persona rows and settings was executed
			expect(hardDeletedUserId).toBe(userId);
			expect(deletedSettingsUserId).toBe(userId);
		});
	});
});
