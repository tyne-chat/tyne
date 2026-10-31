// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createGuildID} from '@app/api/BrandedTypes';
import {viewerFromCtx} from '@app/api/experiment/ChannelThreadsGate';
import {DefaultUserOnly, LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {GuildIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	ChannelGuildCommandParam,
	GuildCommandCounterParam,
	GuildCommandCountListResponseSchema,
	GuildCommandCountSetRequestSchema,
	GuildCommandCreateRequestSchema,
	GuildCommandListResponseSchema,
	GuildCommandParam,
	GuildCommandPreviewRequestSchema,
	GuildCommandPreviewResponseSchema,
	GuildCommandResponseSchema,
	GuildCommandRunRequestSchema,
	GuildCommandUpdateRequestSchema,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {MessageResponseSchema} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

// Fork: routes of server commands (docs/design/server-commands.md, "Routes").

export function GuildCommandController(app: HonoApp) {
	app.get(
		'/users/@me/guild-commands',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_READ),
		LoginRequired,
		DefaultUserOnly,
		OpenAPI({
			operationId: 'list_my_guild_commands',
			summary: 'List the commands of all my communities',
			responseSchema: GuildCommandListResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description:
				'Retrieves the commands of every community the user is a member of, without their templates, for the message composer.',
		}),
		async (ctx) => {
			return ctx.json(await ctx.get('guildCommandService').listForUser(ctx.get('user').id));
		},
	);

	app.get(
		'/guilds/:guild_id/commands',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_READ),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildIdParam),
		OpenAPI({
			operationId: 'list_guild_commands',
			summary: 'List guild commands',
			responseSchema: GuildCommandListResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description:
				"Retrieves a community's commands. Templates are included only for members who may create or manage commands.",
		}),
		async (ctx) => {
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			return ctx.json(await ctx.get('guildCommandService').listForGuild(ctx.get('user').id, guildId));
		},
	);

	app.post(
		'/guilds/:guild_id/commands',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_WRITE),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildIdParam),
		Validator('json', GuildCommandCreateRequestSchema),
		OpenAPI({
			operationId: 'create_guild_command',
			summary: 'Create guild command',
			responseSchema: GuildCommandResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description: 'Creates a command. Requires Create Commands.',
		}),
		async (ctx) => {
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const body = ctx.req.valid('json');
			return ctx.json(await ctx.get('guildCommandService').create(ctx.get('user').id, guildId, body));
		},
	);

	app.post(
		'/guilds/:guild_id/commands/preview',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_PREVIEW),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildIdParam),
		Validator('json', GuildCommandPreviewRequestSchema),
		OpenAPI({
			operationId: 'preview_guild_command',
			summary: 'Preview guild command',
			responseSchema: GuildCommandPreviewResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description:
				'Fills in a template without posting anything. A template with a problem is reported in `issue`, with a 200. Requires Create Commands or Manage Commands.',
		}),
		async (ctx) => {
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const request = ctx.req.valid('json');
			return ctx.json(await ctx.get('guildCommandService').preview({user: ctx.get('user'), guildId, request}));
		},
	);

	app.patch(
		'/guilds/:guild_id/commands/:command_id',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_WRITE),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildCommandParam),
		Validator('json', GuildCommandUpdateRequestSchema),
		OpenAPI({
			operationId: 'update_guild_command',
			summary: 'Update guild command',
			responseSchema: GuildCommandResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description: 'Updates a command. Its creator needs Create Commands; anyone else needs Manage Commands.',
		}),
		async (ctx) => {
			const {guild_id, command_id} = ctx.req.valid('param');
			const body = ctx.req.valid('json');
			return ctx.json(
				await ctx.get('guildCommandService').update(ctx.get('user').id, createGuildID(guild_id), command_id, body),
			);
		},
	);

	app.delete(
		'/guilds/:guild_id/commands/:command_id',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_WRITE),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildCommandParam),
		OpenAPI({
			operationId: 'delete_guild_command',
			summary: 'Delete guild command',
			responseSchema: null,
			statusCode: 204,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description: 'Deletes a command. Its creator needs Create Commands; anyone else needs Manage Commands.',
		}),
		async (ctx) => {
			const {guild_id, command_id} = ctx.req.valid('param');
			await ctx.get('guildCommandService').delete(ctx.get('user').id, createGuildID(guild_id), command_id);
			return ctx.body(null, 204);
		},
	);

	app.get(
		'/guilds/:guild_id/commands/:command_id/counts',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_READ),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildCommandParam),
		OpenAPI({
			operationId: 'list_guild_command_counts',
			summary: 'List guild command counts',
			responseSchema: GuildCommandCountListResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description: "Lists a command's counts, for those who may edit it.",
		}),
		async (ctx) => {
			const {guild_id, command_id} = ctx.req.valid('param');
			return ctx.json(
				await ctx.get('guildCommandService').listCounts(ctx.get('user').id, createGuildID(guild_id), command_id),
			);
		},
	);

	app.put(
		'/guilds/:guild_id/commands/:command_id/counts',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_WRITE),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildCommandParam),
		Validator('json', GuildCommandCountSetRequestSchema),
		OpenAPI({
			operationId: 'set_guild_command_count',
			summary: 'Set guild command count',
			responseSchema: null,
			statusCode: 204,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description: 'Sets one count, for those who may edit the command.',
		}),
		async (ctx) => {
			const {guild_id, command_id} = ctx.req.valid('param');
			await ctx
				.get('guildCommandService')
				.setCount(ctx.get('user').id, createGuildID(guild_id), command_id, ctx.req.valid('json'));
			return ctx.body(null, 204);
		},
	);

	app.delete(
		'/guilds/:guild_id/commands/:command_id/counters/:counter_id/counts',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_WRITE),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildCommandCounterParam),
		OpenAPI({
			operationId: 'reset_guild_command_counter',
			summary: 'Reset guild command counter',
			responseSchema: null,
			statusCode: 204,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description: "Deletes all of a counter's counts, for those who may edit the command.",
		}),
		async (ctx) => {
			const {guild_id, command_id, counter_id} = ctx.req.valid('param');
			await ctx
				.get('guildCommandService')
				.resetCounts(ctx.get('user').id, createGuildID(guild_id), command_id, counter_id);
			return ctx.body(null, 204);
		},
	);

	app.post(
		'/channels/:channel_id/commands/:command_id',
		RateLimitMiddleware(RateLimitConfigs.GUILD_COMMANDS_RUN),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelGuildCommandParam),
		Validator('json', GuildCommandRunRequestSchema),
		OpenAPI({
			operationId: 'run_guild_command',
			summary: 'Run guild command',
			responseSchema: MessageResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Guild Commands'],
			description:
				"Fills in a command's template and posts the result as an ordinary message from the caller. The caller must be a member of the command's community, and needs Use External Commands in another community's channel.",
		}),
		async (ctx) => {
			const {channel_id, command_id} = ctx.req.valid('param');
			const body = ctx.req.valid('json');
			return ctx.json(
				await ctx.get('guildCommandService').run({
					user: ctx.get('user'),
					viewer: viewerFromCtx(ctx),
					channelId: createChannelID(channel_id),
					commandId: command_id,
					request: body,
					requestCache: ctx.get('requestCache'),
				}),
			);
		},
	);
}
