// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount, setUserACLs} from '@app/api/auth/tests/AuthTestUtils';
import {createChannelID, createUserID} from '@app/api/BrandedTypes';
import {createTestBotAccount} from '@app/api/bot/tests/BotTestUtils';
import type {AuthenticatedChannel} from '@app/api/channel/services/AuthenticatedChannel';
import {
	createChannel,
	createPermissionOverwrite,
	setupTestGuildWithMembers,
} from '@app/api/channel/tests/ChannelTestUtils';
import {getPersonaRepository} from '@app/api/middleware/ForkServiceSingletons';
import {getGatewayService} from '@app/api/middleware/ServiceRegistry';
import {
	getCacheService,
	getChannelRepository,
	getGuildRepository,
	getInstanceConfigRepository,
	getUserRepository,
} from '@app/api/middleware/ServiceSingletons';
import {SignalBarService} from '@app/api/signal_bar/SignalBarService';
import {SignalBarSettingsRepository} from '@app/api/signal_bar/SignalBarSettingsRepository';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {
	type ChannelSignalsResponse,
	type ChannelSignalUpdateEvent,
	MAX_USER_SIGNAL_CHATS,
	type SignalBarResponse,
	type UserSignalsPersonaResponse,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi} from 'vitest';

// tyne-chat/tyne#310: one request moves a user's lit signals in some chats to another persona.
describe('signal bar: moving my signals to a persona', () => {
	let harness: ApiTestHarness;
	let dispatchGuild: MockInstance<NoopGatewayService['dispatchGuild']>;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		dispatchGuild = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
	});

	afterEach(() => {
		dispatchGuild.mockRestore();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	const setHomeGuild = async (guildId: string): Promise<void> => {
		const admin = await setUserACLs(harness, await createTestAccount(harness), [
			AdminACLs.AUTHENTICATE,
			AdminACLs.INSTANCE_CONFIG_VIEW,
			AdminACLs.INSTANCE_CONFIG_UPDATE,
		]);
		await createBuilder(harness, admin.token)
			.patch('/admin/instance/config')
			.body({policy: {signal_bar_guild_id: guildId}})
			.execute();
	};

	const light = (token: string, channelId: string, signalId: string, personaId?: string): Promise<void> =>
		createBuilder<void>(harness, token)
			.put(`/channels/${channelId}/signals/${signalId}/@me`)
			.body(personaId ? {persona_id: personaId} : {})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

	const listSignals = (token: string, channelId: string): Promise<ChannelSignalsResponse> =>
		createBuilder<ChannelSignalsResponse>(harness, token).get(`/channels/${channelId}/signals`).execute();

	const mine = async (token: string, channelId: string, userId: string): Promise<Array<[string, string | null]>> =>
		(await listSignals(token, channelId)).entries
			.filter((entry) => entry.user.id === userId)
			.map((entry) => [entry.signal_id, entry.persona_id]);

	const setPersona = (
		token: string,
		body: unknown,
		status: number = HTTP_STATUS.OK,
		code?: string,
	): Promise<UserSignalsPersonaResponse> =>
		createBuilder<UserSignalsPersonaResponse>(harness, token)
			.put('/users/@me/signals/persona')
			.body(body)
			.expect(status, code)
			.execute();

	const createPersona = (token: string, name: string): Promise<PersonaResponse> =>
		createBuilder<PersonaResponse>(harness, token)
			.post('/users/@me/personas')
			.body({name})
			.expect(HTTP_STATUS.CREATED)
			.execute();

	/** The `CHANNEL_SIGNAL_UPDATE` events sent since the spy was set up. */
	const signalUpdates = (): Array<ChannelSignalUpdateEvent> =>
		dispatchGuild.mock.calls
			.map(([params]) => params)
			.filter((params) => params.event === 'CHANNEL_SIGNAL_UPDATE')
			.map((params) => params.data as ChannelSignalUpdateEvent);

	const setup = async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const [member] = members as [TestAccount];
		await setHomeGuild(guild.id);
		await createBuilder(harness, owner.token)
			.put(`/guilds/${guild.id}/signal-bar/channels`)
			.body({default: true, categories: {}, channels: {}})
			.execute();
		const bar = await createBuilder<SignalBarResponse>(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{emoji_name: '📖'}, {emoji_name: '💤'}]})
			.execute();
		const [reading, sleeping] = bar.signals.map((signal) => signal.id) as [string, string];
		const second = await createChannel(harness, owner.token, guild.id, 'second');
		const third = await createChannel(harness, owner.token, guild.id, 'third');
		return {owner, member, guild, first: systemChannel, second, third, reading, sleeping};
	};

	it("moves every one of the user's signals showing another persona, in place, with one event per chat changed", async () => {
		const {owner, member, first, second, third, reading, sleeping} = await setup();
		const [kitsune, wren] = [await createPersona(member.token, 'Kitsune'), await createPersona(member.token, 'Wren')];
		await light(member.token, first.id, reading);
		await light(owner.token, first.id, reading);
		await light(member.token, first.id, sleeping, kitsune.id);
		await light(member.token, second.id, reading, wren.id);
		const before = await listSignals(owner.token, first.id);
		dispatchGuild.mockClear();

		// The second chat already shows Wren, and the third has nothing of the user's.
		const result = await setPersona(member.token, {persona_id: wren.id, channel_ids: [third.id, second.id, first.id]});

		expect(result).toEqual({changed_channel_ids: [first.id]});
		const after = await listSignals(owner.token, first.id);
		expect(after.entries.map((entry) => [entry.signal_id, entry.user.id, entry.persona_id])).toEqual([
			[reading, member.userId, wren.id],
			[reading, owner.userId, null],
			[sleeping, member.userId, wren.id],
		]);
		expect(after.entries.map((entry) => entry.activated_at)).toEqual(before.entries.map((entry) => entry.activated_at));
		expect(after.entries.filter((entry) => entry.user.id === member.userId).map((e) => e.subprofile?.name)).toEqual([
			'Wren',
			'Wren',
		]);
		const updates = signalUpdates();
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({channel_id: first.id, removed: []});
		expect(updates[0]!.added.map((entry) => [entry.signal_id, entry.user.id, entry.persona_id])).toEqual([
			[reading, member.userId, wren.id],
			[sleeping, member.userId, wren.id],
		]);

		// Asking again changes nothing and sends nothing.
		dispatchGuild.mockClear();
		expect(await setPersona(member.token, {persona_id: wren.id, channel_ids: [first.id, second.id]})).toEqual({
			changed_channel_ids: [],
		});
		expect(signalUpdates()).toHaveLength(0);

		// Back to the account, with null or '0', reported in the order asked for.
		expect(await setPersona(member.token, {persona_id: null, channel_ids: [second.id, first.id]})).toEqual({
			changed_channel_ids: [second.id, first.id],
		});
		expect(await mine(member.token, first.id, member.userId)).toEqual([
			[reading, null],
			[sleeping, null],
		]);
		expect(await mine(member.token, second.id, member.userId)).toEqual([[reading, null]]);
		await setPersona(member.token, {persona_id: kitsune.id, channel_ids: [second.id]});
		expect(await setPersona(member.token, {persona_id: '0', channel_ids: [second.id]})).toEqual({
			changed_channel_ids: [second.id],
		});
		expect(await mine(member.token, second.id, member.userId)).toEqual([[reading, null]]);
		expect(signalUpdates().map((update) => update.channel_id)).toEqual([second.id, first.id, second.id, second.id]);
	});

	it('checks the persona once, as lighting does, before changing anything', async () => {
		const {owner, member, first, reading} = await setup();
		const kitsune = await createPersona(member.token, 'Kitsune');
		const theirs = await createPersona(owner.token, 'Theirs');
		await light(member.token, first.id, reading);
		await createBuilder(harness, member.token)
			.delete(`/users/@me/personas/${kitsune.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		dispatchGuild.mockClear();

		for (const personaId of [kitsune.id, theirs.id, '123456789012345678']) {
			await setPersona(
				member.token,
				{persona_id: personaId, channel_ids: [first.id]},
				HTTP_STATUS.NOT_FOUND,
				APIErrorCodes.UNKNOWN_PERSONA,
			);
		}

		expect(await mine(member.token, first.id, member.userId)).toEqual([[reading, null]]);
		expect(signalUpdates()).toHaveLength(0);
	});

	it('leaves alone the chats the user cannot see or may no longer signal in', async () => {
		const {owner, member, first, second, third, reading} = await setup();
		const kitsune = await createPersona(member.token, 'Kitsune');
		for (const channel of [first, second, third]) await light(member.token, channel.id, reading);
		await createPermissionOverwrite(harness, owner.token, second.id, member.userId, {
			type: 1,
			allow: '0',
			deny: Permissions.VIEW_CHANNEL.toString(),
		});
		await createPermissionOverwrite(harness, owner.token, third.id, member.userId, {
			type: 1,
			allow: '0',
			deny: Permissions.SEND_MESSAGES.toString(),
		});
		dispatchGuild.mockClear();

		const result = await setPersona(member.token, {
			persona_id: kitsune.id,
			channel_ids: [second.id, third.id, first.id],
		});

		expect(result).toEqual({changed_channel_ids: [first.id]});
		expect(await mine(owner.token, first.id, member.userId)).toEqual([[reading, kitsune.id]]);
		expect(await mine(owner.token, second.id, member.userId)).toEqual([[reading, null]]);
		expect(await mine(owner.token, third.id, member.userId)).toEqual([[reading, null]]);
		expect(signalUpdates().map((update) => update.channel_id)).toEqual([first.id]);
	});

	it('never lights a signal that was turned off while the request was on its way', async () => {
		const {member, first, reading, sleeping} = await setup();
		const kitsune = await createPersona(member.token, 'Kitsune');
		await light(member.token, first.id, reading);
		await light(member.token, first.id, sleeping);
		const service = new SignalBarService({
			instanceConfigRepository: getInstanceConfigRepository(),
			cacheService: getCacheService(),
			gatewayService: getGatewayService(),
			guildRepository: getGuildRepository(),
			personaRepository: getPersonaRepository(),
			findUser: (userId) => getUserRepository().findUnique(userId),
			findChannel: (channelId) => getChannelRepository().channelData.findUnique(channelId),
			settingsRepository: new SignalBarSettingsRepository(),
			listGuildChannels: (guildId) => getChannelRepository().channelData.listGuildChannels(guildId, 'enrolled'),
		});

		const result = await service.setPersona({
			userId: createUserID(BigInt(member.userId)),
			personaId: kitsune.id,
			channelIds: [first.id],
			// Turned off on another device after the signals were read, before they are moved.
			authenticate: async (channelId) => {
				await createBuilder(harness, member.token)
					.delete(`/channels/${channelId}/signals/${sleeping}/@me`)
					.expect(HTTP_STATUS.NO_CONTENT)
					.execute();
				const channel = await getChannelRepository().channelData.findUnique(createChannelID(BigInt(channelId)));
				return {
					channel: channel!,
					guild: null,
					member: null,
					hasPermission: async () => true,
					checkPermission: async () => {},
				} satisfies AuthenticatedChannel;
			},
		});

		expect(result).toEqual({changed_channel_ids: [first.id]});
		expect(await mine(member.token, first.id, member.userId)).toEqual([[reading, kitsune.id]]);
	});

	it('takes 1 to 200 different chats and a persona or null, and refuses anything else', async () => {
		const {member, first} = await setup();
		const ids = (count: number) => Array.from({length: count}, (_, i) => String(1000 + i));

		expect(await setPersona(member.token, {persona_id: null, channel_ids: ids(MAX_USER_SIGNAL_CHATS)})).toEqual({
			changed_channel_ids: [],
		});
		for (const body of [
			{persona_id: null, channel_ids: ids(MAX_USER_SIGNAL_CHATS + 1)},
			{persona_id: null, channel_ids: []},
			{persona_id: null, channel_ids: [first.id, first.id]},
			{persona_id: null, channel_ids: ['not a snowflake']},
			{persona_id: 'kitsune', channel_ids: [first.id]},
			{channel_ids: [first.id]},
			{persona_id: null},
		]) {
			await setPersona(member.token, body, HTTP_STATUS.BAD_REQUEST);
		}
	});

	it('refuses bots', async () => {
		const bot = await createTestBotAccount(harness);

		await setPersona(
			`Bot ${bot.botToken}`,
			{persona_id: null, channel_ids: ['1000']},
			HTTP_STATUS.FORBIDDEN,
			APIErrorCodes.ACCESS_DENIED,
		);
	});
});
