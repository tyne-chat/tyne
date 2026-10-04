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
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

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

	const createSweepService = (): SignalBarService =>
		new SignalBarService({
			instanceConfigRepository: getInstanceConfigRepository(),
			cacheService: getCacheService(),
			gatewayService: getGatewayService(),
			guildRepository: getGuildRepository(),
			personaRepository: getPersonaRepository(),
			findUser: (userId) => getUserRepository().findUnique(userId),
			findChannel: (channelId) => getChannelRepository().findUnique(channelId),
			settingsRepository: new SignalBarSettingsRepository(),
			listGuildChannels: (guildId) => getChannelRepository().listGuildChannels(guildId),
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

	it('clears signals after two sweeps with no connected session and drops removed signals', async () => {
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
		const service = createSweepService();
		expect(await service.sweep()).toEqual({cleared: 1});
		expect((await listSignals(owner.token, systemChannel.id)).entries).toHaveLength(1);
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
});
