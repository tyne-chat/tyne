// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID} from '@app/api/BrandedTypes';
import {viewerFromCtx} from '@app/api/experiment/ChannelThreadsGate';
import {DefaultUserOnly, LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {getGuildRepository, getUserRepository} from '@app/api/middleware/ServiceSingletons';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {ChannelIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	ChannelPersonaMentionsQuerySchema,
	ChannelPersonaMentionsResponseSchema,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';

export function ChannelPersonaMentionController(app: HonoApp) {
	app.get(
		'/channels/:channel_id/persona-mentions',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_GET),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		Validator('query', ChannelPersonaMentionsQuerySchema),
		OpenAPI({
			operationId: 'get_channel_persona_mentions',
			summary: 'Get persona mention candidates for a channel',
			responseSchema: ChannelPersonaMentionsResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Channels', 'Personas'],
			description:
				'Retrieves mentionable personas belonging to members of the specified channel. Only public personas of other members are returned, along with own personas.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const {q, limit} = ctx.req.valid('query');
			const channelService = ctx.get('channelService');
			const personaService = ctx.get('personaService');
			const guildRepository = getGuildRepository();
			const userRepository = getUserRepository();

			// Verify channel access and get channel context
			const authChannel = await channelService.channelData.auth.getChannelAuthenticated({
				userId: user.id,
				channelId,
				viewer: viewerFromCtx(ctx),
			});

			const userMap = new Map<
				any,
				{username: string; discriminator?: string | null; globalName: string | null; nickname?: string | null}
			>();
			const candidateUserIds: Array<any> = [];

			if (authChannel.channel.guildId) {
				const members = await guildRepository.listMembers(authChannel.channel.guildId);
				const memberNickMap = new Map<any, string | null>();
				const memberUserIds: Array<any> = [];
				for (const m of members) {
					candidateUserIds.push(m.userId);
					memberUserIds.push(m.userId);
					memberNickMap.set(m.userId, m.nickname);
				}
				const users = await userRepository.listUsers(memberUserIds);
				for (const u of users) {
					userMap.set(u.id, {
						username: u.username,
						discriminator: u.discriminator != null ? u.discriminator.toString().padStart(4, '0') : null,
						globalName: u.globalName,
						nickname: memberNickMap.get(u.id) ?? null,
					});
				}
			} else if (authChannel.channel.recipientIds && authChannel.channel.recipientIds.size > 0) {
				const recipientIds = Array.from(authChannel.channel.recipientIds);
				const users = await userRepository.listUsers(recipientIds);
				for (const u of users) {
					candidateUserIds.push(u.id);
					userMap.set(u.id, {
						username: u.username,
						discriminator: u.discriminator != null ? u.discriminator.toString().padStart(4, '0') : null,
						globalName: u.globalName,
						nickname: null,
					});
				}
			} else {
				// Personal notes or solo channel
				candidateUserIds.push(user.id);
				userMap.set(user.id, {
					username: user.username,
					discriminator: user.discriminator != null ? user.discriminator.toString().padStart(4, '0') : null,
					globalName: user.globalName,
					nickname: null,
				});
			}

			// Ensure caller is present in candidateUserIds and userMap
			if (!userMap.has(user.id)) {
				candidateUserIds.push(user.id);
				userMap.set(user.id, {
					username: user.username,
					discriminator: user.discriminator != null ? user.discriminator.toString().padStart(4, '0') : null,
					globalName: user.globalName,
					nickname: null,
				});
			}

			const mentions = await personaService.getChannelPersonaMentions({
				callerUserId: user.id,
				candidateUserIds,
				query: q,
				limit,
				userMap,
			});

			return ctx.json(mentions);
		},
	);
}
