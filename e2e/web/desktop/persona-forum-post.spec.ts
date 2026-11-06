import {expect, type Locator, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// Fork: a forum post made while a persona is selected belongs to that persona: its first message is
// sent as the persona and the API keeps the persona beside the post's owner (ForumPostComposer,
// fluxer_api ThreadCreationService.createForumPost). Others see the persona as the post's author.

test.describe('A forum post as a persona', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';
	const GUILD_FORUM = 15;

	async function account(label: string, stamp: string): Promise<{client: FluxerApiClient; email: string}> {
		const client = new FluxerApiClient(baseURL);
		const email = `pfor_${label}_${stamp}@test.local`;
		await client.register({username: `pfor_${label}_${stamp}`, email, password, global_name: `Forum ${label}`});
		return {client, email};
	}

	// Forum endpoints answer clients that say they support threads, as the web app does.
	const api = async <T = any>(client: FluxerApiClient, method: string, path: string, body?: unknown): Promise<T> => {
		const response = await fetch(`${baseURL}/api/v1${path}`, {
			method,
			headers: {
				Authorization: client.getToken() ?? '',
				'Content-Type': 'application/json',
				'X-Fluxer-Features': 'channel_threads',
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) throw new Error(`API ${method} ${path} failed (${response.status}): ${await response.text()}`);
		return (await response.json()) as T;
	};

	const postComposer = (page: Page) => page.locator('[data-flx="forum.forum-post-composer.composer"]');
	const panel = (page: Page) => page.locator('[data-flx="threads.thread-side-panel.panel"]');
	const messageArticle = (scope: Page | Locator, text: string) =>
		scope.locator('[role="article"]').filter({hasText: text});

	test('is listed and shown under the persona to another account', async ({page, browser}) => {
		const stamp = Date.now().toString().slice(-8);
		const alice = await account('alice', stamp);
		const bob = await account('bob', stamp);
		const guild = await alice.client.createGuild(`Persona Forum ${stamp}`);
		const channels = await alice.client.getGuildChannels(guild.id);
		const text = channels.find((c) => c.type === 0) ?? channels[0]!;
		const forum = await api<{id: string}>(alice.client, 'POST', `/guilds/${guild.id}/channels`, {
			name: `ideas-${stamp}`,
			type: GUILD_FORUM,
		});
		await bob.client.acceptInvite((await alice.client.createInvite(text.id)).code);
		const fox = await bob.client.createPersona({name: `Fox-${stamp}`, visibility: 'public'});
		await bob.client.createPersona({name: `Pip-${stamp}`, visibility: 'public'});

		// Bob opens the post composer and picks Fox with its persona pill.
		await loginAs(page, bob.email, password);
		await page.goto(`/channels/${guild.id}/${forum.id}`);
		await page.locator('[data-flx="forum.forum-toolbar.button.new-post"]').click({timeout: 20_000});
		const pill = postComposer(page).locator('[data-flx="persona.composer-pill"] button');
		await pill.click();
		await page
			.locator(
				'[data-flx="persona.picker-sheet"] [data-flx="persona.persona-picker-sheet.persona-item.select-persona"]',
			)
			.filter({hasText: fox.name})
			.click();
		await expect(pill).toHaveAttribute('aria-label', new RegExp(fox.name));
		// The sheet keeps the focus while it closes, so wait for it to go before typing elsewhere.
		await expect(page.locator('[data-flx="persona.picker-sheet"]')).toHaveCount(0);

		const title = `Fox's idea ${stamp}`;
		const body = `a post written as a persona ${stamp}`;
		await postComposer(page).locator('[data-flx="forum.forum-post-composer.input.set-title"]').fill(title);
		await postComposer(page).locator('[contenteditable="true"]').click();
		await page.keyboard.type(body);
		await postComposer(page).locator('[data-flx="forum.forum-post-composer.button.post"]').click();

		// The post opens for Bob with its first message as Fox.
		await expect(page).toHaveURL(new RegExp(`/channels/${guild.id}/${forum.id}/threads/\\d+`), {timeout: 15_000});
		const postId = /\/threads\/(\d+)/.exec(page.url())![1]!;
		await expect(messageArticle(panel(page), body).getByText(fox.name, {exact: true})).toBeVisible({
			timeout: 15_000,
		});

		// The server stored the post as Fox's and its first message as sent by Fox.
		const post = await api<{name: string; owner_persona_id?: string}>(alice.client, 'GET', `/channels/${postId}`);
		expect(post.name).toBe(title);
		expect(post.owner_persona_id).toBe(fox.id);
		const messages = await api<Array<any>>(alice.client, 'GET', `/channels/${postId}/messages?limit=50`);
		expect(messages.find((m) => m.content === body)?.subprofile?.id).toBe(fox.id);

		// Alice sees the post listed under Fox's name, and Fox as the author of its first message.
		const aliceContext = await browser.newContext();
		try {
			const alicePage = await aliceContext.newPage();
			await loginAs(alicePage, alice.email, password);
			await alicePage.goto(`/channels/${guild.id}/${forum.id}`);
			const card = alicePage.locator('[data-flx="forum.forum-post-card.card.open"]').filter({hasText: title});
			await expect(card.locator('[data-flx="forum.forum-post-card.card-author"]')).toHaveText(`${fox.name}: `, {
				timeout: 20_000,
			});
			await card.click();
			await expect(messageArticle(panel(alicePage), body).getByText(fox.name, {exact: true})).toBeVisible({
				timeout: 15_000,
			});
		} finally {
			await aliceContext.close();
		}
	});
});
