import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// Fork (tyne-chat/tyne#46): in the message search bar, `from:` and `mentions:` suggest personas as
// well as accounts (message_search_bar/PersonasSection.tsx, PersonaSearchSuggestions.ts), and a
// picked persona narrows the search to that persona (search/utils/PersonaSearchFilters.ts).

test.describe('Persona filters in message search', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';

	async function account(label: string, stamp: string): Promise<{client: FluxerApiClient; email: string}> {
		const client = new FluxerApiClient(baseURL);
		const email = `psrch_${label}_${stamp}@test.local`;
		await client.register({username: `psrch_${label}_${stamp}`, email, password, global_name: `Search ${label}`});
		return {client, email};
	}

	/**
	 * Alice owns a community that Bob, with personas Fox and Pip, is in. Bob writes as Fox (twice),
	 * as Pip and as himself; Alice mentions Fox, Pip and Bob. Returns once search finds them all.
	 */
	async function searchableConversation(stamp: string) {
		const alice = await account('alice', stamp);
		const bob = await account('bob', stamp);
		const bobId = (await bob.client.getMe()).id;
		const guild = await alice.client.createGuild(`Persona Search ${stamp}`);
		const channels = await alice.client.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) ?? channels[0]!;
		await bob.client.acceptInvite((await alice.client.createInvite(channel.id)).code);
		const fox = await bob.client.createPersona({name: `Fox-${stamp}`, visibility: 'public'});
		const pip = await bob.client.createPersona({name: `Pip-${stamp}`, visibility: 'public'});

		const text = {
			fox1: `fox writes first ${stamp}`,
			fox2: `fox writes again ${stamp}`,
			pip: `pip writes ${stamp}`,
			bob: `bob writes as himself ${stamp}`,
			toFox: `alice asks fox ${stamp}`,
			toPip: `alice asks pip ${stamp}`,
			toBob: `alice asks bob ${stamp}`,
		};
		await bob.client.sendMessage(channel.id, text.fox1, fox);
		await bob.client.sendMessage(channel.id, text.fox2, fox);
		await bob.client.sendMessage(channel.id, text.pip, pip);
		await bob.client.sendMessage(channel.id, text.bob);
		await alice.client.sendMessage(channel.id, `${text.toFox} <@${bobId}:${fox.id}>`);
		await alice.client.sendMessage(channel.id, `${text.toPip} <@${bobId}:${pip.id}>`);
		await alice.client.sendMessage(channel.id, `${text.toBob} <@${bobId}>`);

		// Search answers "indexing" until the channel is marked indexed, and finds a message once the
		// search engine has taken it in.
		await alice.client.markGuildChannelsIndexed(guild.id);
		const found = async (body: Record<string, unknown>) => {
			const result = await alice.client.searchMessages({...body, context_guild_id: guild.id, scope: 'current'});
			return result.indexing ? null : (result.messages ?? []).map((m) => m.content as string).sort();
		};
		await expect.poll(() => found({persona_id: [fox.id]}), {timeout: 60_000}).toEqual([text.fox1, text.fox2].sort());
		await expect
			.poll(() => found({persona_mentions: [fox.id]}), {timeout: 60_000})
			.toEqual([`${text.toFox} <@${bobId}:${fox.id}>`]);
		await expect.poll(() => found({content: stamp}), {timeout: 60_000}).toHaveLength(7);

		return {alice, guildId: guild.id, channelId: channel.id, fox, text};
	}

	const searchInput = (page: Page) =>
		page.locator('[data-flx="channel.message-search-bar.message-search-bar.input.text"]').first();
	const personaOption = (page: Page, name: string) =>
		page
			.locator('[role="option"]')
			.filter({has: page.locator('[data-flx="channel.message-search-bar.persona-suggestion.name"]')})
			.filter({hasText: name});
	const personasHeader = (page: Page) =>
		page.locator('[data-flx="channel.message-search-bar.personas-section.popout-section-header"]');
	const results = (page: Page) =>
		page.locator('[data-flx="channel.channel-search-results.render-content.message-item"]');

	async function searchForPersona(page: Page, filter: 'from:' | 'mentions:', name: string): Promise<void> {
		await searchInput(page).click();
		await page.keyboard.type(`${filter}${name.slice(0, 5)}`);
		await expect(personasHeader(page)).toBeVisible({timeout: 10_000});
		await personaOption(page, name).click();
		await expect(searchInput(page)).toContainText(name);
		await page.keyboard.press('Enter');
	}

	test("from: offers the persona and finds only that persona's messages", async ({page}) => {
		const stamp = Date.now().toString().slice(-8);
		const {alice, guildId, channelId, fox, text} = await searchableConversation(stamp);

		await loginAs(page, alice.email, password);
		await page.goto(`/channels/${guildId}/${channelId}`);
		await expect(page.getByText(text.toBob)).toBeVisible({timeout: 20_000});

		await searchForPersona(page, 'from:', fox.name);

		await expect(results(page).filter({hasText: text.fox1})).toBeVisible({timeout: 20_000});
		await expect(results(page).filter({hasText: text.fox2})).toBeVisible();
		await expect(results(page)).toHaveCount(2);
		await expect(results(page).getByText(fox.name, {exact: true})).toHaveCount(2);
	});

	test('mentions: offers the persona and finds only the messages that mention it', async ({page}) => {
		const stamp = Date.now().toString().slice(-8);
		const {alice, guildId, channelId, fox, text} = await searchableConversation(stamp);

		await loginAs(page, alice.email, password);
		await page.goto(`/channels/${guildId}/${channelId}`);
		await expect(page.getByText(text.toBob)).toBeVisible({timeout: 20_000});

		await searchForPersona(page, 'mentions:', fox.name);

		const result = results(page).filter({hasText: text.toFox});
		await expect(result).toBeVisible({timeout: 20_000});
		await expect(result.getByText(`@${fox.name}`)).toBeVisible();
		await expect(results(page)).toHaveCount(1);
	});
});
