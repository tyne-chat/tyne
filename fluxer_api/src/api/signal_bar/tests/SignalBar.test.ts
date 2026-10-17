// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount, setUserACLs} from '@app/api/auth/tests/AuthTestUtils';
import {
	createChannel,
	createDmChannel,
	createFriendship,
	createGroupDmChannel,
	setupTestGuildWithMembers,
} from '@app/api/channel/tests/ChannelTestUtils';
import {getGatewayService} from '@app/api/middleware/ServiceRegistry';
import {
	getCacheService,
	getChannelRepository,
	getGuildRepository,
	getInstanceConfigRepository,
	getPersonaRepository,
	getUserRepository,
} from '@app/api/middleware/ServiceSingletons';
import {SignalBarService} from '@app/api/signal_bar/SignalBarService';
import {SignalBarSettingsRepository} from '@app/api/signal_bar/SignalBarSettingsRepository';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import type {InstanceDiscoveryResponse} from '@fluxer/instance_bootstrap/src/Types';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	ChannelSignalsResponse,
	GuildSignalBarSettings,
	SignalBarResponse,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

// Fork imports.

import {createGuildID, createUserID, type GuildID} from '@app/api/BrandedTypes';
import {createEmoji, getPngDataUrl} from '@app/api/emoji/tests/EmojiTestUtils';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import {getSnowflakeService} from '@app/api/middleware/ServiceRegistry';
import {createTestWorkerHelpers} from '@app/api/test/SyncTaskWorkerService';
import sweepSignalBar from '@app/api/worker/tasks/SweepSignalBar';
import {clearWorkerDependencies, setWorkerDependencies} from '@app/api/worker/WorkerContext';
import {initializeWorkerDependencies} from '@app/api/worker/WorkerDependencies';

describe('signal bar', () => {
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

	const setHomeGuild = async (guildId: string | null): Promise<void> => {
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

	const enableEverywhere = (token: string, guildId: string): Promise<GuildSignalBarSettings> =>
		createBuilder<GuildSignalBarSettings>(harness, token)
			.put(`/guilds/${guildId}/signal-bar/channels`)
			.body({default: true, categories: {}, channels: {}})
			.execute();

	const setBar = (token: string, names: Array<string>): Promise<SignalBarResponse> =>
		createBuilder<SignalBarResponse>(harness, token)
			.put('/instance/signal-bar')
			.body({signals: names.map((emoji_name) => ({emoji_name}))})
			.execute();

	const listSignals = (token: string, channelId: string): Promise<ChannelSignalsResponse> =>
		createBuilder<ChannelSignalsResponse>(harness, token).get(`/channels/${channelId}/signals`).execute();

	const HOUR_MS = 60 * 60 * 1000;

	const createSweepService = (
		clock: {now: number; online: boolean | 'unreachable'},
		overrides: {guildRepository?: GuildRepository; gatewayService?: IGatewayService} = {},
	): SignalBarService =>
		new SignalBarService({
			instanceConfigRepository: getInstanceConfigRepository(),
			cacheService: getCacheService(),
			gatewayService:
				overrides.gatewayService ??
				Object.create(getGatewayService(), {
					hasActivePresence: {
						value: async () => {
							if (clock.online === 'unreachable') throw new Error('gateway unreachable');
							return clock.online;
						},
					},
				}),
			guildRepository: overrides.guildRepository ?? getGuildRepository(),
			personaRepository: getPersonaRepository(),
			findUser: (userId) => getUserRepository().findUnique(userId),
			findChannel: (channelId) => getChannelRepository().channelData.findUnique(channelId),
			settingsRepository: new SignalBarSettingsRepository(),
			listGuildChannels: (guildId) => getChannelRepository().channelData.listGuildChannels(guildId, 'enrolled'),
			now: () => clock.now,
		});

	it('is empty and unmanageable until a home community is set', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const before = await createBuilder<SignalBarResponse>(harness, owner.token).get('/instance/signal-bar').execute();
		expect(before).toMatchObject({guild_id: null, can_manage: false, signals: []});
		await createBuilder(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{emoji_name: '📖'}]})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();

		await setHomeGuild(guild.id);
		const discovery = await createBuilder<InstanceDiscoveryResponse>(harness, '').get('/.well-known/fluxer').execute();
		expect(discovery.community.signal_bar_guild_id).toBe(guild.id);
		const after = await createBuilder<SignalBarResponse>(harness, owner.token).get('/instance/signal-bar').execute();
		expect(after).toMatchObject({guild_id: guild.id, can_manage: true, signals: []});
	});

	it('switches the bar off when the home community is cleared', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		await setHomeGuild(null);

		const discovery = await createBuilder<InstanceDiscoveryResponse>(harness, '').get('/.well-known/fluxer').execute();
		expect(discovery.community.signal_bar_guild_id).toBeNull();
		const bar = await createBuilder<SignalBarResponse>(harness, owner.token).get('/instance/signal-bar').execute();
		expect(bar).toMatchObject({guild_id: null, can_manage: false});
	});

	it('lets only home community managers edit the bar and keeps signal ids across reorders', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const [member] = members as [TestAccount];
		await setHomeGuild(guild.id);

		await createBuilder(harness, member.token)
			.put('/instance/signal-bar')
			.body({signals: [{emoji_name: '📖'}]})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{emoji_name: 'not an emoji'}]})
			.expect(HTTP_STATUS.NOT_FOUND)
			.execute();

		const created = await setBar(owner.token, ['📖', '✅']);
		expect(created.signals.map((signal) => signal.emoji_name)).toEqual(['📖', '✅']);
		expect(created.version).toBe(1);

		const [reading, done] = created.signals;
		const reordered = await createBuilder<SignalBarResponse>(harness, owner.token)
			.put('/instance/signal-bar')
			.body({
				signals: [
					{id: done!.id, emoji_name: '✅', label: 'Done'},
					{id: reading!.id, emoji_name: '📖'},
				],
			})
			.execute();
		expect(reordered.signals.map((signal) => signal.id)).toEqual([done!.id, reading!.id]);
		expect(reordered.signals[0]!.label).toBe('Done');
		expect(reordered.version).toBe(2);

		const seenByMember = await createBuilder<SignalBarResponse>(harness, member.token)
			.get('/instance/signal-bar')
			.execute();
		expect(seenByMember.can_manage).toBe(false);
		expect(seenByMember.signals).toEqual(reordered.signals);
	});

	it('keeps one entry per account whose persona follows the latest request', async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const [member] = members as [TestAccount];
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const bar = await setBar(owner.token, ['📖']);
		const signalId = bar.signals[0]!.id;
		const persona = await createBuilder<PersonaResponse>(harness, member.token)
			.post('/users/@me/personas')
			.body({name: 'Kitsune'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const url = `/channels/${systemChannel.id}/signals/${signalId}/@me`;

		await createBuilder(harness, member.token).put(url).body({}).expect(HTTP_STATUS.NO_CONTENT).execute();
		await createBuilder(harness, member.token).put(url).body({}).expect(HTTP_STATUS.NO_CONTENT).execute();
		await createBuilder(harness, owner.token).put(url).body({}).expect(HTTP_STATUS.NO_CONTENT).execute();

		let state = await listSignals(owner.token, systemChannel.id);
		expect(state.bar_version).toBe(bar.version);
		expect(state.entries.map((entry) => [entry.user.id, entry.persona_id])).toEqual([
			[member.userId, null],
			[owner.userId, null],
		]);
		const activatedAt = state.entries[0]!.activated_at;

		await createBuilder(harness, member.token)
			.put(url)
			.body({persona_id: persona.id})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		state = await listSignals(owner.token, systemChannel.id);
		expect(state.entries.map((entry) => [entry.user.id, entry.persona_id])).toEqual([
			[member.userId, persona.id],
			[owner.userId, null],
		]);
		expect(state.entries[0]!.subprofile?.name).toBe('Kitsune');
		expect(state.entries[0]!.activated_at).toBe(activatedAt);

		await createBuilder(harness, member.token).delete(url).expect(HTTP_STATUS.NO_CONTENT).execute();
		state = await listSignals(owner.token, systemChannel.id);
		expect(state.entries.map((entry) => [entry.user.id, entry.persona_id])).toEqual([[owner.userId, null]]);

		await createBuilder(harness, member.token)
			.put(`/channels/${systemChannel.id}/signals/unknown/@me`)
			.body({})
			.expect(HTTP_STATUS.NOT_FOUND)
			.execute();
	});

	it('restricts reset to community managers and group DM owners', async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [member, other] = members as [TestAccount, TestAccount];
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const signalId = (await setBar(owner.token, ['📖'])).signals[0]!.id;

		await createBuilder(harness, member.token)
			.put(`/channels/${systemChannel.id}/signals/${signalId}/@me`)
			.body({})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		await createBuilder(harness, other.token)
			.delete(`/channels/${systemChannel.id}/signals/${signalId}`)
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, owner.token)
			.delete(`/channels/${systemChannel.id}/signals/${signalId}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect((await listSignals(owner.token, systemChannel.id)).entries).toEqual([]);

		await createFriendship(harness, member, other);
		await createFriendship(harness, member, owner);
		const groupDm = await createGroupDmChannel(harness, member.token, [other.userId, owner.userId]);
		await createBuilder(harness, other.token)
			.put(`/channels/${groupDm.id}/signal-bar`)
			.body({enabled: true})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, member.token)
			.put(`/channels/${groupDm.id}/signal-bar`)
			.body({enabled: true})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		await createBuilder(harness, other.token)
			.put(`/channels/${groupDm.id}/signals/${signalId}/@me`)
			.body({})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		await createBuilder(harness, other.token)
			.delete(`/channels/${groupDm.id}/signals/${signalId}`)
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, member.token)
			.delete(`/channels/${groupDm.id}/signals/${signalId}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect((await listSignals(other.token, groupDm.id)).entries).toEqual([]);
	});

	it('keeps signals for 12 hours after the last disconnect and drops removed signals at once', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const bar = await setBar(owner.token, ['📖', '✅']);
		const [reading, done] = bar.signals;
		await createBuilder(harness, owner.token)
			.put(`/channels/${systemChannel.id}/signals/${reading!.id}/@me`)
			.body({})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		await createBuilder(harness, owner.token)
			.put(`/channels/${systemChannel.id}/signals/${done!.id}/@me`)
			.body({})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		await createBuilder(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{id: reading!.id, emoji_name: '📖'}]})
			.execute();
		const clock = {now: 0, online: false};
		const service = createSweepService(clock);
		expect(await service.sweep()).toEqual({cleared: 1});
		expect((await listSignals(owner.token, systemChannel.id)).entries).toHaveLength(1);

		clock.now = 11 * HOUR_MS;
		clock.online = true;
		expect(await service.sweep()).toEqual({cleared: 0});
		clock.now = 12 * HOUR_MS;
		clock.online = false;
		expect(await service.sweep()).toEqual({cleared: 0});
		clock.now = 24 * HOUR_MS - 1;
		expect(await service.sweep()).toEqual({cleared: 0});
		expect((await listSignals(owner.token, systemChannel.id)).entries).toHaveLength(1);

		clock.now = 24 * HOUR_MS;
		expect(await service.sweep()).toEqual({cleared: 1});
		expect((await listSignals(owner.token, systemChannel.id)).entries).toEqual([]);
	});

	it('is off in every channel until a manager switches it on, and channels inherit from their category', async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const [member] = members as [TestAccount];
		await setHomeGuild(guild.id);
		const signalId = (await setBar(owner.token, ['📖'])).signals[0]!.id;
		const category = await createChannel(harness, owner.token, guild.id, 'cat', 4);
		const inCategory = await createBuilder<{id: string}>(harness, owner.token)
			.post(`/guilds/${guild.id}/channels`)
			.body({name: 'inside', type: 0, parent_id: category.id})
			.execute();

		expect((await listSignals(owner.token, systemChannel.id)).enabled).toBe(false);
		await createBuilder(harness, owner.token)
			.put(`/channels/${systemChannel.id}/signals/${signalId}/@me`)
			.body({})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, member.token)
			.put(`/guilds/${guild.id}/signal-bar/channels`)
			.body({default: true, categories: {}, channels: {}})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, member.token)
			.get(`/guilds/${guild.id}/signal-bar/channels`)
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();

		const saved = await createBuilder<GuildSignalBarSettings>(harness, owner.token)
			.put(`/guilds/${guild.id}/signal-bar/channels`)
			.body({
				default: false,
				categories: {[category.id]: true, '999999999999999999': true},
				channels: {[systemChannel.id]: true, [category.id]: true},
			})
			.execute();
		expect(saved).toEqual({
			default: false,
			categories: {[category.id]: true},
			channels: {[systemChannel.id]: true},
		});
		expect((await listSignals(owner.token, systemChannel.id)).enabled).toBe(true);
		expect((await listSignals(owner.token, inCategory.id)).enabled).toBe(true);

		const later = await createBuilder<{id: string}>(harness, owner.token)
			.post(`/guilds/${guild.id}/channels`)
			.body({name: 'later', type: 0, parent_id: category.id})
			.execute();
		const loose = await createChannel(harness, owner.token, guild.id, 'loose');
		expect((await listSignals(owner.token, later.id)).enabled).toBe(true);
		expect((await listSignals(owner.token, loose.id)).enabled).toBe(false);
	});

	it('clears lit signals when a channel is switched off', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const signalId = (await setBar(owner.token, ['📖'])).signals[0]!.id;
		await createBuilder(harness, owner.token)
			.put(`/channels/${systemChannel.id}/signals/${signalId}/@me`)
			.body({})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		await createBuilder(harness, owner.token)
			.put(`/guilds/${guild.id}/signal-bar/channels`)
			.body({default: true, categories: {}, channels: {[systemChannel.id]: false}})
			.execute();
		expect(await listSignals(owner.token, systemChannel.id)).toMatchObject({enabled: false, entries: []});

		await enableEverywhere(owner.token, guild.id);
		expect(await listSignals(owner.token, systemChannel.id)).toMatchObject({enabled: true, entries: []});
	});

	it('lets either person switch the bar on in a one-on-one DM', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const [member] = members as [TestAccount];
		await setHomeGuild(guild.id);
		const signalId = (await setBar(owner.token, ['📖'])).signals[0]!.id;
		await createFriendship(harness, owner, member);
		const dm = await createDmChannel(harness, owner.token, member.userId);

		expect((await listSignals(member.token, dm.id)).enabled).toBe(false);
		await createBuilder(harness, member.token)
			.put(`/channels/${dm.id}/signal-bar`)
			.body({enabled: true})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect((await listSignals(owner.token, dm.id)).enabled).toBe(true);
		await createBuilder(harness, owner.token)
			.put(`/channels/${dm.id}/signals/${signalId}/@me`)
			.body({})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		await createBuilder(harness, owner.token)
			.put(`/channels/${dm.id}/signal-bar`)
			.body({enabled: false})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect(await listSignals(member.token, dm.id)).toMatchObject({enabled: false, entries: []});
	});

	it("lets managers turn off one person's signal and refuses everyone else", async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 2);
		const [member, other] = members as [TestAccount, TestAccount];
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const signalId = (await setBar(owner.token, ['📖'])).signals[0]!.id;
		const url = `/channels/${systemChannel.id}/signals/${signalId}`;
		await createBuilder(harness, member.token).put(`${url}/@me`).body({}).expect(HTTP_STATUS.NO_CONTENT).execute();
		await createBuilder(harness, other.token).put(`${url}/@me`).body({}).expect(HTTP_STATUS.NO_CONTENT).execute();

		await createBuilder(harness, other.token)
			.delete(`${url}/users/${member.userId}`)
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();
		await createBuilder(harness, owner.token)
			.delete(`${url}/users/${member.userId}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		const state = await listSignals(owner.token, systemChannel.id);
		expect(state.entries.map((entry) => entry.user.id)).toEqual([other.userId]);
	});

	it('accepts up to 50 signals and rejects more than 50', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);

		const fiftySignals = Array.from({length: 50}, () => ({emoji_name: '😀'}));
		const bar = await createBuilder<SignalBarResponse>(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: fiftySignals})
			.execute();
		expect(bar.signals).toHaveLength(50);

		const fiftyOneSignals = Array.from({length: 51}, () => ({emoji_name: '😀'}));
		await createBuilder(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: fiftyOneSignals})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
	});

	const lightSignal = async (token: string, channelId: string, signalId: string): Promise<void> => {
		await createBuilder(harness, token)
			.put(`/channels/${channelId}/signals/${signalId}/@me`)
			.body({})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
	};

	it('refuses a custom emoji that does not exist and text that is not an emoji', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);

		await createBuilder(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{emoji_id: '123456789012345678', emoji_name: 'missing'}]})
			.expect(HTTP_STATUS.NOT_FOUND)
			.execute();
		await createBuilder(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{emoji_name: 'reading'}]})
			.expect(HTTP_STATUS.NOT_FOUND)
			.execute();
	});

	it('drops a signal from the bar once its custom emoji is deleted', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		const emoji = await createEmoji(harness, owner.token, guild.id, {name: 'bar_emoji', image: getPngDataUrl()});
		const before = await createBuilder<SignalBarResponse>(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{emoji_id: emoji.id, emoji_name: emoji.name}, {emoji_name: '📖'}]})
			.execute();
		expect(before.signals.map((signal) => signal.emoji_id)).toEqual([emoji.id, null]);

		await createBuilder(harness, owner.token)
			.delete(`/guilds/${guild.id}/emojis/${emoji.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		await createSweepService({now: 0, online: true}).sweep();

		const after = await createBuilder<SignalBarResponse>(harness, owner.token).get('/instance/signal-bar').execute();
		expect(after.signals.map((signal) => signal.emoji_name)).toEqual(['📖']);
		expect(after.version).toBe(before.version + 1);
	});

	it('keeps signals while it cannot tell whether someone is online', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const [reading] = (await setBar(owner.token, ['📖'])).signals;
		await lightSignal(owner.token, systemChannel.id, reading!.id);

		const clock: {now: number; online: boolean | 'unreachable'} = {now: 0, online: 'unreachable'};
		const service = createSweepService(clock);
		expect(await service.sweep()).toEqual({cleared: 0});
		clock.now = 48 * HOUR_MS;
		expect(await service.sweep()).toEqual({cleared: 0});

		expect((await listSignals(owner.token, systemChannel.id)).entries).toHaveLength(1);
	});

	it('forgets an account once none of its signals are left', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const [reading] = (await setBar(owner.token, ['📖'])).signals;
		await lightSignal(owner.token, systemChannel.id, reading!.id);
		await createBuilder(harness, owner.token)
			.delete(`/channels/${systemChannel.id}/signals/${reading!.id}/@me`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect(await getCacheService().smembers('signalbar:users')).toContain(owner.userId);

		expect(await createSweepService({now: 0, online: true}).sweep()).toEqual({cleared: 0});

		expect(await getCacheService().smembers('signalbar:users')).not.toContain(owner.userId);
	});

	it('leaves out and forgets a stored signal it cannot read', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const [reading] = (await setBar(owner.token, ['📖'])).signals;
		await lightSignal(owner.token, systemChannel.id, reading!.id);
		const member = `${reading!.id}:${owner.userId}`;
		await getCacheService().set(`signalbar:entry:${systemChannel.id}:${member}`, {not: 'an entry'}, 600);

		expect((await listSignals(owner.token, systemChannel.id)).entries).toEqual([]);
		expect(await getCacheService().smembers(`signalbar:channel:${systemChannel.id}`)).not.toContain(member);
	});

	it('tells every community about a bar change, page by page, even when one dispatch fails', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		const communities = Array.from({length: 101}, (_, index) => ({id: createGuildID(BigInt(9_000_000 + index))}));
		const pagesAfter: Array<GuildID | undefined> = [];
		const dispatched: Array<GuildID> = [];
		const guildRepository = Object.create(getGuildRepository(), {
			listAllGuildsPaginated: {
				value: async (limit: number, lastGuildId?: GuildID) => {
					pagesAfter.push(lastGuildId);
					const start = lastGuildId === undefined ? 0 : communities.findIndex((c) => c.id === lastGuildId) + 1;
					return communities.slice(start, start + limit);
				},
			},
		});
		const gatewayService = Object.create(getGatewayService(), {
			dispatchGuild: {
				value: async ({guildId}: {guildId: GuildID}) => {
					dispatched.push(guildId);
					if (guildId === communities[0]!.id) throw new Error('community unreachable');
				},
			},
		});

		await createSweepService({now: 0, online: true}, {guildRepository, gatewayService}).updateBar(
			createUserID(BigInt(owner.userId)),
			{signals: [{emoji_name: '📖'}]},
		);

		expect(pagesAfter).toEqual([undefined, communities[99]!.id]);
		expect(dispatched).toHaveLength(101);
	});

	it('runs the sweep as a worker task and logs what it cleared', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		await setHomeGuild(guild.id);
		await enableEverywhere(owner.token, guild.id);
		const [reading, done] = (await setBar(owner.token, ['📖', '✅'])).signals;
		await lightSignal(owner.token, systemChannel.id, done!.id);
		await createBuilder(harness, owner.token)
			.put('/instance/signal-bar')
			.body({signals: [{id: reading!.id, emoji_name: '📖'}]})
			.execute();

		setWorkerDependencies(await initializeWorkerDependencies(getSnowflakeService()));
		try {
			const helpers = createTestWorkerHelpers();
			const debug = vi.spyOn(helpers.logger, 'debug');
			await sweepSignalBar({}, helpers);
			expect(debug).toHaveBeenCalledWith({cleared: 1}, expect.any(String));
		} finally {
			clearWorkerDependencies();
		}
		expect((await listSignals(owner.token, systemChannel.id)).entries).toEqual([]);
	});
});
