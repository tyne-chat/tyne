import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// The path a persona mention takes through the real services: the messages service parses it
// with the Markdown parser (code is not a mention), the API names it in `mention_personas` as the
// persona is now, stores it on the message for search when its account was mentioned, and the
// web app shows it. Read-time naming and search are checked through the API, then once on screen.

test.describe('Persona mentions through the messages service', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';

	async function account(label: string, stamp: string): Promise<{client: FluxerApiClient; email: string}> {
		const client = new FluxerApiClient(baseURL);
		const email = `pmp_${label}_${stamp}@test.local`;
		await client.register({
			username: `pmp_${label}_${stamp}`,
			email,
			password,
			global_name: `Pipeline ${label}`,
		});
		return {client, email};
	}

	async function sharedChannel(owner: FluxerApiClient, member: FluxerApiClient, stamp: string) {
		const guild = await owner.createGuild(`Mention Pipeline ${stamp}`);
		const channels = await owner.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) ?? channels[0]!;
		const invite = await owner.createInvite(channel.id);
		await member.acceptInvite(invite.code);
		return {guildId: guild.id, channelId: channel.id};
	}

	/** The IDs of this run's messages that a persona-mention search finds, once the channel is indexed. */
	async function foundByPersona(client: FluxerApiClient, guildId: string, personaId: string, stamp: string) {
		const result = await client.searchMessages({
			content: stamp,
			persona_mentions: [personaId],
			context_guild_id: guildId,
			scope: 'current',
		});
		return result.indexing ? null : (result.messages ?? []).map((m) => m.id).sort();
	}

	test('is named as the persona is now, searched as stored, and shown in the web app', async ({page}) => {
		const stamp = Date.now().toString().slice(-8);
		const alice = await account('alice', stamp);
		const bob = await account('bob', stamp);
		const bobId = (await bob.client.getMe()).id;
		const {guildId, channelId} = await sharedChannel(alice.client, bob.client, stamp);
		const fox = await bob.client.createPersona({name: `Fox-${stamp}`, visibility: 'public'});
		const pip = await bob.client.createPersona({name: `Pip-${stamp}`, visibility: 'private'});

		// Content: a mention in code is not one.
		const plain = await alice.client.sendMessage(
			channelId,
			`plain ${stamp} <@${bobId}:${fox.id}> \`<@${bobId}:${pip.id}>\``,
		);
		expect(plain.mention_personas?.map((p: {id: string}) => p.id)).toEqual([fox.id]);

		// A private persona is named, as a message sent as it is.
		const toPip = await alice.client.sendMessage(channelId, `private ${stamp} <@${bobId}:${pip.id}>`);
		expect(toPip.mention_personas?.map((p: {name: string}) => p.name)).toEqual([`Pip-${stamp}`]);

		// What a forward carries is read too.
		const forward = await alice.client.sendMessageBody(channelId, {
			message_reference: {channel_id: channelId, message_id: plain.id, type: 1},
		});
		expect(forward.mention_personas?.map((p: {id: string}) => p.id)).toEqual([fox.id]);

		// Held back with allowed_mentions: shown as the persona, not stored as a mention.
		const quiet = await alice.client.sendMessageBody(channelId, {
			content: `quiet ${stamp} <@${bobId}:${fox.id}>`,
			allowed_mentions: {parse: []},
		});
		expect(quiet.mention_personas?.map((p: {id: string}) => p.id)).toEqual([fox.id]);

		// Renamed: older messages show the new name.
		await bob.client.updatePersona(fox.id, {name: `Vixen-${stamp}`});
		const listed = await alice.client.getMessages(channelId);
		expect(listed.find((m) => m.id === plain.id)?.mention_personas?.[0]?.name).toBe(`Vixen-${stamp}`);
		expect(listed.find((m) => m.id === plain.id)).not.toHaveProperty('persona_mentions');

		await alice.client.markGuildChannelsIndexed(guildId);

		// Search finds the mention stored at send time, and the forward, which keeps the mentions
		// of what it carries as upstream keeps their accounts; not the one held back.
		await expect
			.poll(() => foundByPersona(alice.client, guildId, fox.id, stamp), {timeout: 60_000})
			.toEqual([plain.id, forward.id].sort());
		await expect
			.poll(() => foundByPersona(alice.client, guildId, pip.id, stamp), {timeout: 60_000})
			.toEqual([toPip.id]);

		// An edit that drops the mention drops it from search.
		await alice.client.editMessage(channelId, toPip.id, `private ${stamp} no one`);
		await expect.poll(() => foundByPersona(alice.client, guildId, pip.id, stamp), {timeout: 60_000}).toEqual([]);

		// On screen, the older message names the persona by its new name.
		await loginAs(page, alice.email, password);
		await page.goto(`/channels/${guildId}/${channelId}`);
		const plainMessage = page
			.locator('[data-flx*="message-content"]')
			.filter({hasText: `plain ${stamp}`})
			.first();
		await expect(plainMessage).toBeVisible({timeout: 20_000});
		await expect(
			plainMessage
				.locator('[data-flx*="mention-renderer"], span[role="button"]')
				.filter({hasText: `@Vixen-${stamp}`})
				.first(),
		).toBeVisible({timeout: 10_000});
	});
});
