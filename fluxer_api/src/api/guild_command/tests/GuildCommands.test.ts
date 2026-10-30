// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createGuildID} from '@app/api/BrandedTypes';
import {createDmChannel, createFriendship, setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import {
	acceptInvite,
	addMemberRole,
	createChannelInvite,
	createGuild,
	createRole,
	getChannel,
	updateRole,
} from '@app/api/guild/tests/GuildTestUtils';
import {escapeGuildCommandName} from '@app/api/guild_command/GuildCommandTemplateEngine';
import {resetForkGuildCommandUseCache} from '@app/api/guild_command/GuildCommandUses';
import {backfillUseExternalCommands} from '@app/api/guild_command/UseExternalCommandsBackfill';
import {getGatewayService} from '@app/api/middleware/ServiceRegistry';
import {getGuildRepository, getInstanceConfigRepository} from '@app/api/middleware/ServiceSingletons';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {NoopGatewayService} from '@app/api/test/NoopGatewayService';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {DEFAULT_PERMISSIONS, Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {
	GuildCommandPreviewResponse,
	GuildCommandResponse,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

describe('server commands', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		resetForkGuildCommandUseCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	const TUCK = {
		name: 'tuck',
		description: 'Tuck someone in to sleep',
		template: '# **{{ person }} tucks {{ input }} in to sleep! Goodnight!**',
		input_mode: 'required',
	};

	const createCommand = (token: string, guildId: string, body: Record<string, unknown> = TUCK) =>
		createBuilder<GuildCommandResponse>(harness, token).post(`/guilds/${guildId}/commands`).body(body);

	/** The name templates print for an account with no nickname. */
	const nameOf = async (token: string) => {
		const me = await createBuilder<{global_name: string | null; username: string}>(harness, token)
			.get('/users/@me')
			.execute();
		return escapeGuildCommandName(me.global_name ?? me.username);
	};

	const runCommand = (token: string, channelId: string, commandId: string, body: Record<string, unknown>) =>
		createBuilder<MessageResponse>(harness, token)
			.post(`/channels/${channelId}/commands/${commandId}`)
			.body({nonce: `${Date.now()}${Math.floor(Math.random() * 1000)}`, ...body});

	it('lets the owner create a command and shows templates only to editors', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const created = await createCommand(owner.token, guild.id).execute();
		expect(created).toMatchObject({name: 'tuck', kind: 'basic', input_mode: 'required', template: TUCK.template});

		const forOwner = await createBuilder<Array<GuildCommandResponse>>(harness, owner.token)
			.get(`/guilds/${guild.id}/commands`)
			.execute();
		expect(forOwner[0]?.template).toBe(TUCK.template);

		const forMember = await createBuilder<Array<GuildCommandResponse>>(harness, members[0]!.token)
			.get(`/guilds/${guild.id}/commands`)
			.execute();
		expect(forMember).toHaveLength(1);
		expect(forMember[0]?.template).toBeUndefined();
	});

	it('refuses members without Create Commands, and announces changes', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		await createCommand(members[0]!.token, guild.id).expect(403).execute();

		const dispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
		await createCommand(owner.token, guild.id).execute();
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({event: 'GUILD_COMMANDS_UPDATE', data: {guild_id: guild.id}}),
		);
	});

	it('refuses built-in names, taken names and templates with a problem', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		await createCommand(owner.token, guild.id, {...TUCK, name: 'me'})
			.expect(400, 'GUILD_COMMAND_NAME_TAKEN')
			.execute();
		await createCommand(owner.token, guild.id).execute();
		await createCommand(owner.token, guild.id).expect(400, 'GUILD_COMMAND_NAME_TAKEN').execute();
		await createCommand(owner.token, guild.id, {...TUCK, name: 'open', template: '{% if target %}x'})
			.expect(400, 'GUILD_COMMAND_TEMPLATE_INVALID')
			.execute();
		await createCommand(owner.token, guild.id, {...TUCK, name: 'loop', template: '{% for i in (1..3) %}{% endfor %}'})
			.expect(400, 'GUILD_COMMAND_TEMPLATE_INVALID')
			.execute();
		await createCommand(owner.token, guild.id, {...TUCK, name: 'Tuck'})
			.expect(400)
			.execute();
	});

	it('says what is wrong with a template that cannot be saved', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const {json} = await createCommand(owner.token, guild.id, {...TUCK, template: 'ok\n{% nosuch %}'})
			.expect(400, 'GUILD_COMMAND_TEMPLATE_INVALID')
			.executeRaw();
		expect(json).toMatchObject({template_issue: {code: 'unknown_tag', line: 2, column: 1, name: 'nosuch'}});
	});

	it('saves a script as a script, and as basic once the logic is gone', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const template = '{% if target %}{{ person }} hugs {{ target }}{% else %}{{ person }} hugs the air{% endif %}';
		const command = await createCommand(owner.token, guild.id, {...TUCK, template}).execute();
		expect(command.kind).toBe('script');
		const path = `/guilds/${guild.id}/commands/${command.id}`;
		const edited = await createBuilder<GuildCommandResponse>(harness, owner.token)
			.patch(path)
			.body({template: '{{ person }} hugs {{ input }}'})
			.execute();
		expect(edited.kind).toBe('basic');
	});

	it('runs a script, with the first mention as the target', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const friend = members[0]!;
		const template = `{% assign size = input | size %}
{% if target %}
{{ person }} hugs {{ target }}, {{ target.name }}!
{% else %}
{{ person }} hugs {{ size | ordinal }} {{ size | plural: "thing", "things" }} in {{ channel.name }}
{% endif %}`;
		const command = await createCommand(owner.token, guild.id, {...TUCK, template}).execute();
		const hugged = await runCommand(owner.token, guild.system_channel_id!, command.id, {
			input: `<@${friend.userId}>`,
		}).execute();
		expect(hugged.content).toBe(`<@${owner.userId}> hugs <@${friend.userId}>, ${await nameOf(friend.token)}!`);
		expect(hugged.command?.id).toBe(command.id);
		const empty = await runCommand(owner.token, guild.system_channel_id!, command.id, {input: 'ab'}).execute();
		expect(empty.content).toBe(`<@${owner.userId}> hugs 2nd things in general`);
	});

	it('tells someone running a broken command only that it is broken', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const broken = await createCommand(owner.token, guild.id, {
			...TUCK,
			template: '{{ person.constructor }}',
		}).execute();
		const {json} = await runCommand(owner.token, guild.system_channel_id!, broken.id, {input: 'x'})
			.expect(400, 'GUILD_COMMAND_TEMPLATE_INVALID')
			.executeRaw();
		expect(json).not.toHaveProperty('template_issue');
		const silent = await createCommand(owner.token, guild.id, {
			...TUCK,
			name: 'silent',
			template: '{% if false %}never{% endif %}',
		}).execute();
		await runCommand(owner.token, guild.system_channel_id!, silent.id, {input: 'x'})
			.expect(400, 'GUILD_COMMAND_TEMPLATE_INVALID')
			.execute();
	});

	describe('preview', () => {
		const preview = (token: string, guildId: string, body: Record<string, unknown>) =>
			createBuilder<GuildCommandPreviewResponse>(harness, token).post(`/guilds/${guildId}/commands/preview`).body(body);

		it('fills in a template without posting it', async () => {
			const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
			const channelId = guild.system_channel_id!;
			const messages = () =>
				createBuilder<Array<MessageResponse>>(harness, owner.token)
					.get(`/channels/${channelId}/messages?limit=10`)
					.execute();
			const before = await messages();
			const result = await preview(owner.token, guild.id, {
				template: '{{ person.name }} in {{ channel }}: {{ input | upcase }}',
				input: 'hello',
				channel_id: channelId,
			}).execute();
			expect(result).toEqual({content: `${await nameOf(owner.token)} in <#${channelId}>: HELLO`, issue: null});
			expect(await messages()).toHaveLength(before.length);
		});

		it('answers with the problem, not a failed request', async () => {
			const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
			const result = await preview(owner.token, guild.id, {template: 'one\ntwo {{ input | nosuch }}'}).execute();
			expect(result).toEqual({
				content: null,
				issue: {code: 'unknown_filter', line: 2, column: 5, name: 'nosuch'},
			});
		});

		it('needs Create Commands or Manage Commands', async () => {
			const {owner, members, guild} = await setupTestGuildWithMembers(harness, 2);
			const [creator, manager] = members as [(typeof members)[0], (typeof members)[0]];
			await preview(creator.token, guild.id, {template: 'x'}).expect(403).execute();
			const give = async (userId: string, permission: bigint) => {
				const role = await createRole(harness, owner.token, guild.id, {
					name: 'editor',
					permissions: permission.toString(),
				});
				await addMemberRole(harness, owner.token, guild.id, userId, role.id);
			};
			await give(creator.userId, Permissions.CREATE_COMMANDS);
			await give(manager.userId, Permissions.MANAGE_COMMANDS);
			await preview(creator.token, guild.id, {template: 'x'}).execute();
			await preview(manager.token, guild.id, {template: 'x'}).execute();
			const outsider = await createTestAccount(harness);
			await preview(outsider.token, guild.id, {template: 'x'}).expect(403).execute();
		});

		it('fills in only a channel of this community that the member can see', async () => {
			const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
			const other = await createGuild(harness, owner.token, 'Elsewhere');
			const template = '[{{ channel }}]';
			const elsewhere = await preview(owner.token, guild.id, {
				template,
				channel_id: other.system_channel_id,
			}).execute();
			expect(elsewhere.content).toBe('[]');
			vi.spyOn(getGatewayService(), 'checkPermission').mockImplementation(
				async ({permission}) => permission !== Permissions.VIEW_CHANNEL,
			);
			const hidden = await preview(owner.token, guild.id, {
				template,
				channel_id: guild.system_channel_id,
			}).execute();
			expect(hidden.content).toBe('[]');
		});
	});

	it('lets a creator edit their own command, and only Manage Commands edit others', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 2);
		const [creator, other] = members as [(typeof members)[0], (typeof members)[0]];
		const createRoleWith = async (permissions: bigint) => {
			const role = await createRole(harness, owner.token, guild.id, {name: 'r', permissions: permissions.toString()});
			return role.id;
		};
		const creatorRole = await createRoleWith(Permissions.CREATE_COMMANDS);
		await addMemberRole(harness, owner.token, guild.id, creator.userId, creatorRole);
		await addMemberRole(harness, owner.token, guild.id, other.userId, creatorRole);

		const command = await createCommand(creator.token, guild.id).execute();
		const path = `/guilds/${guild.id}/commands/${command.id}`;
		await createBuilder(harness, creator.token).patch(path).body({description: 'mine'}).execute();
		await createBuilder(harness, other.token).patch(path).body({description: 'theirs'}).expect(403).execute();

		const managerRole = await createRoleWith(Permissions.MANAGE_COMMANDS);
		await addMemberRole(harness, owner.token, guild.id, other.userId, managerRole);
		await createBuilder(harness, other.token).patch(path).body({description: 'managed'}).execute();
		await createBuilder(harness, other.token).delete(path).expect(204).execute();
	});

	it('posts the filled-in message with the command on it, and an edit removes it', async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const member = members[0]!;
		const command = await createCommand(owner.token, guild.id).execute();

		const message = await runCommand(member.token, systemChannel.id, command.id, {
			input: `<@${owner.userId}>`,
		}).execute();
		expect(message.content).toBe(`# **<@${member.userId}> tucks <@${owner.userId}> in to sleep! Goodnight!**`);
		expect(message.author.id).toBe(member.userId);
		expect(message.command).toEqual({id: command.id, guild_id: guild.id, name: 'tuck'});

		const listed = await createBuilder<Array<MessageResponse>>(harness, member.token)
			.get(`/channels/${systemChannel.id}/messages?limit=5`)
			.execute();
		expect(listed.find((m) => m.id === message.id)?.command?.name).toBe('tuck');

		const edited = await createBuilder<MessageResponse>(harness, member.token)
			.patch(`/channels/${systemChannel.id}/messages/${message.id}`)
			.body({content: 'something else'})
			.execute();
		expect(edited.command ?? null).toBeNull();
	});

	it("posts as the member's persona, and refuses someone else's", async () => {
		const {owner, members, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const command = await createCommand(owner.token, guild.id).execute();
		const persona = await createBuilder<{id: string}>(harness, owner.token)
			.post('/users/@me/personas')
			.body({name: 'Yami'})
			.expect(201)
			.execute();

		const message = await runCommand(owner.token, systemChannel.id, command.id, {
			input: 'everyone',
			persona_id: persona.id,
		}).execute();
		expect(message.content?.startsWith(`# **<@${owner.userId}:${persona.id}> tucks`)).toBe(true);
		expect(message.subprofile?.id).toBe(persona.id);

		await runCommand(members[0]!.token, systemChannel.id, command.id, {input: 'x', persona_id: persona.id})
			.expect(404)
			.execute();
	});

	it('checks the input against the command', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		const required = await createCommand(owner.token, guild.id).execute();
		const none = await createCommand(owner.token, guild.id, {...TUCK, name: 'vanish', input_mode: 'none'}).execute();
		await runCommand(owner.token, systemChannel.id, required.id, {})
			.expect(400, 'GUILD_COMMAND_INPUT_INVALID')
			.execute();
		await runCommand(owner.token, systemChannel.id, none.id, {input: 'x'})
			.expect(400, 'GUILD_COMMAND_INPUT_INVALID')
			.execute();
		await runCommand(owner.token, systemChannel.id, required.id, {input: 'two\nlines'}).expect(400).execute();
	});

	it("works in another community's channel, unless Use External Commands is off there", async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const member = members[0]!;
		const command = await createCommand(owner.token, guild.id).execute();

		const other = await createGuild(harness, member.token, 'Elsewhere');
		const otherChannel = await getChannel(harness, member.token, other.system_channel_id!);
		const outsider = await createTestAccount(harness);
		await acceptInvite(
			harness,
			outsider.token,
			(await createChannelInvite(harness, member.token, otherChannel.id)).code,
		);

		const message = await runCommand(member.token, otherChannel.id, command.id, {input: 'everyone'}).execute();
		expect(message.command?.guild_id).toBe(guild.id);

		await updateRole(harness, member.token, other.id, other.id, {
			permissions: (DEFAULT_PERMISSIONS & ~Permissions.USE_EXTERNAL_COMMANDS).toString(),
		});
		await acceptInvite(harness, owner.token, (await createChannelInvite(harness, member.token, otherChannel.id)).code);
		await runCommand(owner.token, otherChannel.id, command.id, {input: 'x'}).expect(403).execute();
	});

	it('works in a DM with someone who shares no community, but not for non-members', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const command = await createCommand(owner.token, guild.id).execute();
		const friend = await createTestAccount(harness);
		await createFriendship(harness, owner, friend);
		const dm = await createDmChannel(harness, owner.token, friend.userId);

		const message = await runCommand(owner.token, dm.id, command.id, {input: `<@${friend.userId}>`}).execute();
		expect(message.command?.name).toBe('tuck');

		await runCommand(friend.token, dm.id, command.id, {input: 'x'}).expect(404, 'UNKNOWN_GUILD_COMMAND').execute();
	});

	it("lists the commands of all of a user's communities, without templates", async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const second = await createGuild(harness, owner.token, 'Second');
		await createCommand(owner.token, guild.id).execute();
		await createCommand(owner.token, second.id, {...TUCK, name: 'hug'}).execute();
		const outsider = await createTestAccount(harness);

		const mine = await createBuilder<Array<GuildCommandResponse>>(harness, owner.token)
			.get('/users/@me/guild-commands')
			.execute();
		expect(mine.map((command) => command.name).sort()).toEqual(['hug', 'tuck']);
		expect(mine.every((command) => command.template === undefined)).toBe(true);

		const theirs = await createBuilder<Array<GuildCommandResponse>>(harness, outsider.token)
			.get('/users/@me/guild-commands')
			.execute();
		expect(theirs).toEqual([]);
	});

	it('turns Use External Commands on once for existing @everyone roles', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const without = (DEFAULT_PERMISSIONS & ~Permissions.USE_EXTERNAL_COMMANDS).toString();
		await updateRole(harness, owner.token, guild.id, guild.id, {permissions: without});
		const deps = {
			guildRepository: getGuildRepository(),
			gatewayService: getGatewayService(),
			instanceConfigRepository: getInstanceConfigRepository(),
		};
		const everyone = async () =>
			(await getGuildRepository().listRoles(createGuildID(BigInt(guild.id)))).find(
				(role) => role.id.toString() === guild.id,
			);

		const dispatch = vi.spyOn(NoopGatewayService.prototype, 'dispatchGuild');
		expect(await backfillUseExternalCommands(deps)).toEqual({ran: true, updated: 1});
		expect((await everyone())!.permissions & Permissions.USE_EXTERNAL_COMMANDS).toBe(Permissions.USE_EXTERNAL_COMMANDS);
		expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({event: 'GUILD_ROLE_UPDATE'}));

		await updateRole(harness, owner.token, guild.id, guild.id, {permissions: without});
		expect(await backfillUseExternalCommands(deps)).toEqual({ran: false, updated: 0});
		expect((await everyone())!.permissions & Permissions.USE_EXTERNAL_COMMANDS).toBe(0n);
	});

	it('defaults Use External Commands on for @everyone, and Manage Commands is elevated', () => {
		expect(DEFAULT_PERMISSIONS & Permissions.USE_EXTERNAL_COMMANDS).toBe(Permissions.USE_EXTERNAL_COMMANDS);
		expect(DEFAULT_PERMISSIONS & Permissions.CREATE_COMMANDS).toBe(0n);
	});
});
