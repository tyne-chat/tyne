// SPDX-License-Identifier: AGPL-3.0-or-later

import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {createGuild} from '@app/api/guild/tests/GuildTestUtils';
import {escapeGuildCommandName} from '@app/api/guild_command/GuildCommandTemplateEngine';
import {resetForkGuildCommandUseCache} from '@app/api/guild_command/GuildCommandUses';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import type {
	GuildCommandPreviewResponse,
	GuildCommandResponse,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('server command counters', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		resetForkGuildCommandUseCache();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	const create = (token: string, guildId: string, body: Record<string, unknown>) =>
		createBuilder<GuildCommandResponse>(harness, token).post(`/guilds/${guildId}/commands`).body(body);

	const run = (token: string, channelId: string, commandId: string, body: Record<string, unknown> = {}) =>
		createBuilder<MessageResponse>(harness, token)
			.post(`/channels/${channelId}/commands/${commandId}`)
			.body({nonce: `${Date.now()}${Math.floor(Math.random() * 100000)}`, ...body});

	const HUG = {
		name: 'hug',
		template: '{{ target.name }} has {{ hugs }} {{ hugs | plural: "hug", "hugs" }}, you gave {{ given }}',
		input_mode: 'required',
		counters: [
			{name: 'hugs', per: ['target']},
			{name: 'given', per: ['person', 'target']},
		],
	};

	const tally = (template: string, counters: Array<Record<string, unknown>>, input_mode = 'none') => ({
		name: 'tally',
		template,
		input_mode,
		counters,
	});

	it('counts each run, and the first reads 1', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 2);
		const [friend, other] = [members[0]!, members[1]!];
		const command = await create(owner.token, guild.id, HUG).execute();
		const channel = guild.system_channel_id!;
		const me = await createBuilder<{global_name: string | null; username: string}>(harness, friend.token)
			.get('/users/@me')
			.execute();
		const name = escapeGuildCommandName(me.global_name ?? me.username);
		const hug = async (token: string) =>
			(await run(token, channel, command.id, {input: `<@${friend.userId}>`}).execute()).content;

		expect(await hug(owner.token)).toBe(`${name} has 1 hug, you gave 1`);
		expect(await hug(owner.token)).toBe(`${name} has 2 hugs, you gave 2`);
		expect(await hug(other.token)).toBe(`${name} has 3 hugs, you gave 1`);
	});

	it('keeps a count through a nickname change, as it is kept by id', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const friend = members[0]!;
		const command = await create(owner.token, guild.id, {...HUG, template: '{{ hugs }}'}).execute();
		const channel = guild.system_channel_id!;
		await run(owner.token, channel, command.id, {input: `<@${friend.userId}>`}).execute();

		await createBuilder(harness, friend.token)
			.patch(`/guilds/${guild.id}/members/@me`)
			.body({nick: 'Someone new'})
			.execute();

		const message = await run(owner.token, channel, command.id, {input: `<@${friend.userId}>`}).execute();
		expect(message.content).toBe('2');
	});

	it('refuses a run with no mention for a counter kept per recipient, and counts nothing', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const command = await create(owner.token, guild.id, {...HUG, template: '{{ hugs }}'}).execute();
		const channel = guild.system_channel_id!;

		await run(owner.token, channel, command.id, {input: 'Yami'}).expect(400, 'GUILD_COMMAND_INPUT_INVALID').execute();

		const message = await run(owner.token, channel, command.id, {input: `<@${members[0]!.userId}>`}).execute();
		expect(message.content).toBe('1');
	});

	it('counts a persona apart from its account, unless the counter says account', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const persona = await createBuilder<{id: string}>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Yami'})
			.expect(201)
			.execute();
		const command = await create(
			owner.token,
			guild.id,
			tally('{{ apart }}/{{ together }}', [
				{name: 'apart', per: ['person']},
				{name: 'together', per: ['person'], identity: 'account'},
			]),
		).execute();
		const channel = guild.system_channel_id!;

		await run(owner.token, channel, command.id).execute();
		const message = await run(owner.token, channel, command.id, {persona_id: persona.id}).execute();

		expect(message.content).toBe('1/2');
	});

	it('keeps one count per channel, or one for the command', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const other = await createGuild(harness, owner.token, 'Elsewhere');
		const command = await create(
			owner.token,
			guild.id,
			tally('{{ here }}/{{ all }}', [
				{name: 'here', per: ['channel']},
				{name: 'all', per: []},
			]),
		).execute();

		await run(owner.token, guild.system_channel_id!, command.id).execute();
		const message = await run(owner.token, other.system_channel_id!, command.id).execute();

		expect(message.content).toBe('1/2');
	});

	it('does not count a run the send refuses, or the same nonce twice', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const command = await create(
			owner.token,
			guild.id,
			tally('{{ all }}{{ input }}', [{name: 'all', per: []}], 'required'),
		).execute();
		const channel = guild.system_channel_id!;

		await run(owner.token, channel, command.id, {input: 'x'.repeat(2500)})
			.expect(400)
			.execute();
		await run(owner.token, channel, command.id, {input: 'a', nonce: '777'}).execute();
		await run(owner.token, channel, command.id, {input: 'a', nonce: '777'}).execute();

		const counts = await createBuilder<Array<{value: number}>>(harness, owner.token)
			.get(`/guilds/${guild.id}/commands/${command.id}/counts`)
			.execute();
		expect(counts.map((count) => count.value)).toEqual([1]);
	});

	it('refuses counters that cannot work', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const bad = (counters: Array<Record<string, unknown>>, mode = 'required') =>
			create(owner.token, guild.id, tally('hi', counters, mode))
				.expect(400)
				.execute();

		await bad([{name: 'person', per: []}]);
		await bad([{name: 'Has Spaces', per: []}]);
		await bad([
			{name: 'a', per: []},
			{name: 'a', per: []},
		]);
		await bad([{name: 'a', per: ['target']}], 'none');
		await bad(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({name, per: []})));
	});

	it('lets an editor rename a counter, set a count and reset it, and nobody else', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const command = await create(owner.token, guild.id, tally('{{ all }}', [{name: 'all', per: []}])).execute();
		const counter = command.counters![0]!;
		const channel = guild.system_channel_id!;
		const path = `/guilds/${guild.id}/commands/${command.id}`;
		await run(owner.token, channel, command.id).execute();

		await createBuilder(harness, owner.token)
			.patch(path)
			.body({template: '{{ total }}', counters: [{id: counter.id, name: 'total', per: []}]})
			.execute();
		expect((await run(owner.token, channel, command.id).execute()).content).toBe('2');

		await createBuilder(harness, owner.token)
			.put(`${path}/counts`)
			.body({counter_id: counter.id, scope_key: 'all', value: 40})
			.expect(204)
			.execute();
		expect((await run(owner.token, channel, command.id).execute()).content).toBe('41');

		await createBuilder(harness, members[0]!.token)
			.delete(`${path}/counters/${counter.id}/counts`)
			.expect(403)
			.execute();
		await createBuilder(harness, owner.token).delete(`${path}/counters/${counter.id}/counts`).expect(204).execute();
		expect((await run(owner.token, channel, command.id).execute()).content).toBe('1');
	});

	it('forgets the counts of a counter that is removed', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const command = await create(owner.token, guild.id, tally('{{ all }}', [{name: 'all', per: []}])).execute();
		const path = `/guilds/${guild.id}/commands/${command.id}`;
		await run(owner.token, guild.system_channel_id!, command.id).execute();

		await createBuilder(harness, owner.token).patch(path).body({counters: []}).execute();

		const counts = await createBuilder<Array<unknown>>(harness, owner.token).get(`${path}/counts`).execute();
		expect(counts).toEqual([]);
	});

	it('shows counters only to editors, and fills them in the preview', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		await create(owner.token, guild.id, {...HUG, template: '{{ hugs }}'}).execute();
		const list = (token: string) =>
			createBuilder<Array<GuildCommandResponse>>(harness, token).get(`/guilds/${guild.id}/commands`).execute();

		expect((await list(owner.token))[0]?.counters).toHaveLength(2);
		expect((await list(members[0]!.token))[0]?.counters).toBeUndefined();

		const preview = await createBuilder<GuildCommandPreviewResponse>(harness, owner.token)
			.post(`/guilds/${guild.id}/commands/preview`)
			.body({template: '{{ hugs }} {{ hugs | ordinal }}', counters: [{name: 'hugs', per: []}]})
			.execute();
		expect(preview.content).toBe('1 1st');
	});
});
