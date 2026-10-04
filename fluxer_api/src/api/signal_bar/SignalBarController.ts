// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createGuildID, createUserID} from '@app/api/BrandedTypes';
import {DefaultUserOnly, LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {ChannelIdParam, GuildIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	ChannelSignalBarEnabledRequestSchema,
	ChannelSignalParam,
	ChannelSignalsResponseSchema,
	ChannelSignalToggleRequestSchema,
	ChannelSignalUserParam,
	GuildSignalBarSettingsSchema,
	SignalBarResponseSchema,
	SignalBarUpdateRequestSchema,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';

export function SignalBarController(app: HonoApp) {
	app.get(
		'/instance/signal-bar',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_READ),
		LoginRequired,
		OpenAPI({
			operationId: 'get_signal_bar',
			summary: 'Get signal bar',
			responseSchema: SignalBarResponseSchema,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description: 'Retrieves the instance-wide signal bar and whether the authenticated user may edit it.',
		}),
		async (ctx) => {
			return ctx.json(await ctx.get('signalBarService').getBar(ctx.get('user').id));
		},
	);

	app.put(
		'/instance/signal-bar',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_MUTATE),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', SignalBarUpdateRequestSchema),
		OpenAPI({
			operationId: 'update_signal_bar',
			summary: 'Update signal bar',
			responseSchema: SignalBarResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description:
				'Replaces the ordered list of signals. Requires Manage Community in the home community that owns the bar.',
		}),
		async (ctx) => {
			const body = ctx.req.valid('json');
			return ctx.json(await ctx.get('signalBarService').updateBar(ctx.get('user').id, body));
		},
	);

	app.get(
		'/channels/:channel_id/signals',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_READ),
		LoginRequired,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'list_channel_signals',
			summary: 'List active channel signals',
			responseSchema: ChannelSignalsResponseSchema,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description: 'Retrieves everyone currently giving a signal in the channel.',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const authChannel = await ctx
				.get('channelService')
				.interactions.authService.getChannelAuthenticated({userId, channelId});
			return ctx.json(await ctx.get('signalBarService').getChannelSignals(authChannel));
		},
	);

	app.put(
		'/channels/:channel_id/signals/:signal_id/@me',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_TOGGLE),
		LoginRequired,
		Validator('param', ChannelSignalParam),
		Validator('json', ChannelSignalToggleRequestSchema),
		OpenAPI({
			operationId: 'activate_channel_signal',
			summary: 'Give a signal',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description:
				'Turns a signal on in the channel for the authenticated user, or updates the persona they are signalling as. An account holds at most one entry per signal.',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const {channel_id, signal_id} = ctx.req.valid('param');
			const authChannel = await ctx
				.get('channelService')
				.interactions.authService.getChannelAuthenticated({userId, channelId: createChannelID(channel_id)});
			await ctx.get('signalBarService').activate({
				authChannel,
				userId,
				signalId: signal_id,
				personaId: ctx.req.valid('json')?.persona_id,
			});
			return ctx.body(null, 204);
		},
	);

	app.delete(
		'/channels/:channel_id/signals/:signal_id/@me',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_TOGGLE),
		LoginRequired,
		Validator('param', ChannelSignalParam),
		OpenAPI({
			operationId: 'deactivate_channel_signal',
			summary: 'Withdraw a signal',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description: 'Turns a signal off in the channel for the authenticated user.',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const {channel_id, signal_id} = ctx.req.valid('param');
			const authChannel = await ctx
				.get('channelService')
				.interactions.authService.getChannelAuthenticated({userId, channelId: createChannelID(channel_id)});
			await ctx.get('signalBarService').deactivate({authChannel, userId, signalId: signal_id});
			return ctx.body(null, 204);
		},
	);

	app.delete(
		'/channels/:channel_id/signals/:signal_id',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_MUTATE),
		LoginRequired,
		Validator('param', ChannelSignalParam),
		OpenAPI({
			operationId: 'reset_channel_signal',
			summary: 'Reset a signal',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description:
				'Turns a signal off for everyone in the channel. Requires Manage Community in a community channel, or ownership of a group DM.',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const {channel_id, signal_id} = ctx.req.valid('param');
			const authChannel = await ctx
				.get('channelService')
				.interactions.authService.getChannelAuthenticated({userId, channelId: createChannelID(channel_id)});
			await ctx.get('signalBarService').reset({authChannel, userId, signalId: signal_id});
			return ctx.body(null, 204);
		},
	);

	app.delete(
		'/channels/:channel_id/signals/:signal_id/users/:user_id',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_MUTATE),
		LoginRequired,
		Validator('param', ChannelSignalUserParam),
		OpenAPI({
			operationId: 'remove_channel_signal_user',
			summary: "Turn off someone's signal",
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description:
				"Turns one account's signal off. Requires Manage Community in a community channel, or ownership of a group DM.",
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const {channel_id, signal_id, user_id} = ctx.req.valid('param');
			const authChannel = await ctx
				.get('channelService')
				.interactions.authService.getChannelAuthenticated({userId, channelId: createChannelID(channel_id)});
			await ctx.get('signalBarService').removeUserSignal({
				authChannel,
				userId,
				signalId: signal_id,
				targetUserId: createUserID(user_id),
			});
			return ctx.body(null, 204);
		},
	);

	app.put(
		'/channels/:channel_id/signal-bar',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_MUTATE),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		Validator('json', ChannelSignalBarEnabledRequestSchema),
		OpenAPI({
			operationId: 'set_dm_signal_bar_enabled',
			summary: 'Switch the signal bar on or off in a DM',
			responseSchema: null,
			statusCode: 204,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description:
				'Switches the signal bar on or off in a direct message. Either participant of a one-on-one DM or the owner of a group DM may do this. Community channels are configured through the community endpoint.',
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const authChannel = await ctx
				.get('channelService')
				.interactions.authService.getChannelAuthenticated({userId, channelId});
			await ctx.get('signalBarService').setDmEnabled(authChannel, userId, ctx.req.valid('json').enabled);
			return ctx.body(null, 204);
		},
	);

	app.get(
		'/guilds/:guild_id/signal-bar/channels',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_READ),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildIdParam),
		OpenAPI({
			operationId: 'get_guild_signal_bar_channels',
			summary: 'Get where the signal bar is switched on in a community',
			responseSchema: GuildSignalBarSettingsSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description:
				'Retrieves the community default, per-category defaults and per-channel exceptions. Requires Manage Community.',
		}),
		async (ctx) => {
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			return ctx.json(await ctx.get('signalBarService').getGuildSettings(guildId, ctx.get('user').id));
		},
	);

	app.put(
		'/guilds/:guild_id/signal-bar/channels',
		RateLimitMiddleware(RateLimitConfigs.SIGNAL_BAR_MUTATE),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', GuildIdParam),
		Validator('json', GuildSignalBarSettingsSchema),
		OpenAPI({
			operationId: 'update_guild_signal_bar_channels',
			summary: 'Choose where the signal bar is switched on in a community',
			responseSchema: GuildSignalBarSettingsSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Signal Bar'],
			description:
				'Replaces the community default, per-category defaults and per-channel exceptions. Channels without their own setting inherit from their category, then from the community. Requires Manage Community.',
		}),
		async (ctx) => {
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const body = ctx.req.valid('json');
			return ctx.json(await ctx.get('signalBarService').updateGuildSettings(guildId, ctx.get('user').id, body));
		},
	);
}
