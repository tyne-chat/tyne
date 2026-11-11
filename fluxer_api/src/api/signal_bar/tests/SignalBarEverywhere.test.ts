// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount, setUserACLs} from '@app/api/auth/tests/AuthTestUtils';
import {
	createChannel,
	createPermissionOverwrite,
	setupTestGuildWithMembers,
} from '@app/api/channel/tests/ChannelTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	ChannelSignalsResponse,
	SignalBarResponse,
	UserSignalsResponse,
	UserSignalsRestoreResponse,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('signal bar: signals everywhere', () => {
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

	const setBar = (
		token: string,
		signals: Array<{id?: string; emoji_name: string; everywhere?: boolean}>,
	): Promise<SignalBarResponse> =>
		createBuilder<SignalBarResponse>(harness, token).put('/instance/signal-bar').body({signals}).execute();

	const light = (token: string, channelId: string, signalId: string, personaId?: string): Promise<void> =>
		createBuilder<void>(harness, token)
			.put(`/channels/${channelId}/signals/${signalId}/@me`)
			.body(personaId ? {persona_id: personaId} : {})
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

	const mine = async (token: string, channelId: string, userId: string): Promise<Array<[string, string | null]>> => {
		const state = await createBuilder<ChannelSignalsResponse>(harness, token)
			.get(`/channels/${channelId}/signals`)
			.execute();
		return state.entries
			.filter((entry) => entry.user.id === userId)
			.map((entry) => [entry.signal_id, entry.persona_id]);
	};

	const setEverywhere = (
		token: string,
		body: {signal_id: string | null; channel_id?: string; persona_id?: string},
		status: number = HTTP_STATUS.OK,
	): Promise<UserSignalsResponse> =>
		createBuilder<UserSignalsResponse>(harness, token).put('/users/@me/signals').body(body).expect(status).execute();

	const restore = (token: string): Promise<UserSignalsResponse> =>
		createBuilder<UserSignalsResponse>(harness, token).post('/users/@me/signals/restore').execute();

	const setup = async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const [member] = members as [TestAccount];
		await setHomeGuild(guild.id);
		await createBuilder(harness, owner.token)
			.put(`/guilds/${guild.id}/signal-bar/channels`)
			.body({default: true, categories: {}, channels: {}})
			.execute();
		const bar = await setBar(owner.token, [{emoji_name: '📖'}, {emoji_name: '💤', everywhere: true}]);
		const [reading, sleeping] = bar.signals as [SignalBarResponse['signals'][0], SignalBarResponse['signals'][0]];
		const second = await createChannel(harness, owner.token, guild.id, 'second');
		const third = await createChannel(harness, owner.token, guild.id, 'third');
		return {owner, member, guild, first: systemChannel, second, third, reading, sleeping};
	};

	it('sets a ticked signal where the user has one on and in the open chat, each keeping its persona', async () => {
		const {member, first, second, third, reading, sleeping} = await setup();
		const kitsune = await createBuilder<PersonaResponse>(harness, member.token)
			.post('/users/@me/personas')
			.body({name: 'Kitsune'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const wren = await createBuilder<PersonaResponse>(harness, member.token)
			.post('/users/@me/personas')
			.body({name: 'Wren'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		await light(member.token, first.id, reading.id, kitsune.id);
		await light(member.token, second.id, reading.id);

		const summary = await setEverywhere(member.token, {
			signal_id: sleeping.id,
			channel_id: third.id,
			persona_id: wren.id,
		});

		expect(await mine(member.token, first.id, member.userId)).toEqual([[sleeping.id, kitsune.id]]);
		expect(await mine(member.token, second.id, member.userId)).toEqual([[sleeping.id, null]]);
		expect(await mine(member.token, third.id, member.userId)).toEqual([[sleeping.id, wren.id]]);
		expect(summary.restore_available).toBe(true);
		expect(summary.chats.map((chat) => chat.channel_id).sort()).toEqual([first.id, second.id, third.id].sort());
		for (const chat of summary.chats) expect(chat.signals.map((ref) => ref.signal_id)).toEqual([sleeping.id]);

		const preview = await createBuilder<UserSignalsRestoreResponse>(harness, member.token)
			.get('/users/@me/signals/restore')
			.execute();
		expect(preview.action).toEqual({kind: 'set', signal_id: sleeping.id});
		const byChannel = new Map(preview.chats.map((chat) => [chat.channel_id, chat]));
		expect(byChannel.get(first.id)).toMatchObject({
			available: true,
			now: [{signal_id: sleeping.id, persona_id: kitsune.id}],
			after: [{signal_id: reading.id, persona_id: kitsune.id}],
		});
		expect(byChannel.get(third.id)).toMatchObject({available: true, after: []});

		await restore(member.token);
		expect(await mine(member.token, first.id, member.userId)).toEqual([[reading.id, kitsune.id]]);
		expect(await mine(member.token, second.id, member.userId)).toEqual([[reading.id, null]]);
		expect(await mine(member.token, third.id, member.userId)).toEqual([]);

		await restore(member.token);
		expect(await mine(member.token, first.id, member.userId)).toEqual([[sleeping.id, kitsune.id]]);
		expect(await mine(member.token, third.id, member.userId)).toEqual([[sleeping.id, wren.id]]);
	});

	it('sets only signals ticked for everywhere, and keeps the tick when an edit leaves it out', async () => {
		const {owner, member, first, reading, sleeping} = await setup();
		await light(member.token, first.id, sleeping.id);

		await setEverywhere(member.token, {signal_id: reading.id}, HTTP_STATUS.FORBIDDEN);
		await setEverywhere(member.token, {signal_id: 'unknown'}, HTTP_STATUS.NOT_FOUND);

		const kept = await setBar(owner.token, [
			{id: sleeping.id, emoji_name: '💤'},
			{id: reading.id, emoji_name: '📖'},
		]);
		expect(kept.signals.map((signal) => [signal.id, signal.everywhere])).toEqual([
			[sleeping.id, true],
			[reading.id, false],
		]);
		const unticked = await setBar(owner.token, [{id: sleeping.id, emoji_name: '💤', everywhere: false}]);
		expect(unticked.signals[0]!.everywhere).toBe(false);
		await setEverywhere(member.token, {signal_id: sleeping.id}, HTTP_STATUS.FORBIDDEN);
	});

	it('turns everything off, even where the user can no longer post, and restore leaves those chats out', async () => {
		const {owner, member, first, second, reading, sleeping} = await setup();
		await light(member.token, first.id, reading.id);
		await light(member.token, second.id, reading.id);
		await createPermissionOverwrite(harness, owner.token, second.id, member.userId, {
			type: 1,
			allow: '0',
			deny: Permissions.SEND_MESSAGES.toString(),
		});

		await setEverywhere(member.token, {signal_id: sleeping.id});
		expect(await mine(member.token, first.id, member.userId)).toEqual([[sleeping.id, null]]);
		expect(await mine(member.token, second.id, member.userId)).toEqual([[reading.id, null]]);

		const off = await setEverywhere(member.token, {signal_id: null});
		expect(off).toEqual({chats: [], restore_available: true});
		expect(await mine(member.token, first.id, member.userId)).toEqual([]);
		expect(await mine(member.token, second.id, member.userId)).toEqual([]);

		const preview = await createBuilder<UserSignalsRestoreResponse>(harness, member.token)
			.get('/users/@me/signals/restore')
			.execute();
		expect(preview.action).toEqual({kind: 'off', signal_id: null});
		expect(new Map(preview.chats.map((chat) => [chat.channel_id, chat.available]))).toEqual(
			new Map([
				[first.id, true],
				[second.id, false],
			]),
		);

		await restore(member.token);
		expect(await mine(member.token, first.id, member.userId)).toEqual([[sleeping.id, null]]);
		expect(await mine(member.token, second.id, member.userId)).toEqual([]);
	});

	it('keeps the previous restore when a change everywhere changes nothing', async () => {
		const {member, first, reading, sleeping} = await setup();
		await light(member.token, first.id, reading.id);

		await setEverywhere(member.token, {signal_id: sleeping.id});
		await setEverywhere(member.token, {signal_id: sleeping.id});
		await restore(member.token);

		expect(await mine(member.token, first.id, member.userId)).toEqual([[reading.id, null]]);
	});

	it('has nothing to restore until the first change everywhere', async () => {
		const {member, first, reading} = await setup();
		await light(member.token, first.id, reading.id);

		const summary = await createBuilder<UserSignalsResponse>(harness, member.token).get('/users/@me/signals').execute();
		expect(summary).toMatchObject({restore_available: false, chats: [{channel_id: first.id}]});
		expect(
			await createBuilder<UserSignalsRestoreResponse>(harness, member.token)
				.get('/users/@me/signals/restore')
				.execute(),
		).toEqual({available: false, created_at: null, action: null, chats: []});
		await restore(member.token);
		expect(await mine(member.token, first.id, member.userId)).toEqual([[reading.id, null]]);
	});

	it("falls back to the account when a chat's persona was deleted before a restore", async () => {
		const {member, first, reading, sleeping} = await setup();
		const kitsune = await createBuilder<PersonaResponse>(harness, member.token)
			.post('/users/@me/personas')
			.body({name: 'Kitsune'})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		await light(member.token, first.id, reading.id, kitsune.id);
		await setEverywhere(member.token, {signal_id: sleeping.id});
		await createBuilder(harness, member.token)
			.delete(`/users/@me/personas/${kitsune.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		await restore(member.token);

		expect(await mine(member.token, first.id, member.userId)).toEqual([[reading.id, null]]);
	});

	it("restores a chat's signals in their order, so the newest still decides its persona", async () => {
		const {owner, member, first, reading, sleeping} = await setup();
		const done = (
			await setBar(owner.token, [
				{id: reading.id, emoji_name: '📖'},
				{id: sleeping.id, emoji_name: '💤', everywhere: true},
				{emoji_name: '✅', everywhere: true},
			])
		).signals[2]!;
		const [kitsune, wren] = await Promise.all(
			['Kitsune', 'Wren'].map((name) =>
				createBuilder<PersonaResponse>(harness, member.token)
					.post('/users/@me/personas')
					.body({name})
					.expect(HTTP_STATUS.CREATED)
					.execute(),
			),
		);
		await light(member.token, first.id, reading.id, kitsune!.id);
		await light(member.token, first.id, sleeping.id, wren!.id);

		await setEverywhere(member.token, {signal_id: null});
		await restore(member.token);
		expect(await mine(member.token, first.id, member.userId)).toEqual([
			[reading.id, kitsune!.id],
			[sleeping.id, wren!.id],
		]);

		await setEverywhere(member.token, {signal_id: done.id});
		expect(await mine(member.token, first.id, member.userId)).toEqual([[done.id, wren!.id]]);
	});
});
