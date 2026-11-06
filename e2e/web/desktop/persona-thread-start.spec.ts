import {expect, type Locator, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// Fork: a thread started while a persona is selected in its channel is the persona's. The API keeps
// the persona beside the thread's owner (fluxer_api persona/ThreadOwnerPersonaStore.ts) and the web
// app names it at the top of the thread (ThreadCreatePane, persona/utils/ThreadOwnerPersona.ts).

test.describe('Starting a thread as a persona', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const password = 'TestPassword123!';

	async function account(label: string, stamp: string): Promise<{client: FluxerApiClient; email: string}> {
		const client = new FluxerApiClient(baseURL);
		const email = `pthr_${label}_${stamp}@test.local`;
		await client.register({username: `pthr_${label}_${stamp}`, email, password, global_name: `Thread ${label}`});
		return {client, email};
	}

	// Thread endpoints answer clients that say they support threads, as the web app does.
	const api = async <T = any>(client: FluxerApiClient, path: string): Promise<T> => {
		const response = await fetch(`${baseURL}/api/v1${path}`, {
			headers: {Authorization: client.getToken() ?? '', 'X-Fluxer-Features': 'channel_threads'},
		});
		if (!response.ok) throw new Error(`API GET ${path} failed (${response.status}): ${await response.text()}`);
		return (await response.json()) as T;
	};

	const composer = (page: Page) =>
		page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
	const panel = (page: Page) => page.locator('[data-flx="threads.thread-side-panel.panel"]');
	const startedBy = (page: Page) => panel(page).locator('[data-flx="threads.thread-welcome-section.description"]');
	const messageArticle = (scope: Page | Locator, text: string) =>
		scope.locator('[role="article"]').filter({hasText: text});

	test("the thread and its first message are the persona's, for its starter and for others", async ({
		page,
		browser,
	}) => {
		const stamp = Date.now().toString().slice(-8);
		const alice = await account('alice', stamp);
		const bob = await account('bob', stamp);
		const guild = await alice.client.createGuild(`Persona Threads ${stamp}`);
		const channels = await alice.client.getGuildChannels(guild.id);
		const channel = channels.find((c) => c.type === 0) ?? channels[0]!;
		await bob.client.acceptInvite((await alice.client.createInvite(channel.id)).code);
		const fox = await bob.client.createPersona({name: `Fox-${stamp}`, visibility: 'public'});
		await bob.client.createPersona({name: `Pip-${stamp}`, visibility: 'public'});

		const sourceText = `thread source ${stamp}`;
		const source = await alice.client.sendMessage(channel.id, sourceText);

		// Bob selects Fox in the channel with the composer's persona pill.
		await loginAs(page, bob.email, password);
		await page.goto(`/channels/${guild.id}/${channel.id}`);
		await expect(composer(page)).toBeVisible({timeout: 20_000});
		const pill = page.locator('[data-flx="persona.composer-pill"] button').first();
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

		// He starts a thread from Alice's message and writes its first message.
		const sourceMessage = messageArticle(page, sourceText);
		await expect(sourceMessage).toBeVisible({timeout: 15_000});
		await sourceMessage.hover();
		await page
			.locator('button[data-flx="channel.message-action-bar.message-action-bar-button.button.click"]')
			.and(page.getByRole('button', {name: 'Create thread', exact: true}))
			.click();
		const threadName = `Fox thread ${stamp}`;
		await panel(page).locator('[data-flx="threads.thread-create-pane.input.name"]').fill(threadName);
		const firstText = `first words in the thread ${stamp}`;
		await panel(page).locator('[contenteditable="true"]').click();
		await page.keyboard.type(firstText);
		await page.keyboard.press('Enter');

		// The thread opens; it reads as started by Fox, and its first message is Fox's.
		await expect(startedBy(page)).toHaveText(`Started by ${fox.name}`, {timeout: 15_000});
		const firstMessage = messageArticle(panel(page), firstText);
		await expect(firstMessage.getByText(fox.name, {exact: true})).toBeVisible({timeout: 15_000});

		// The server stored the same: the thread (named after the message it started from) and the
		// message carry Fox.
		const thread = await api<{name: string; owner_persona_id?: string}>(alice.client, `/channels/${source.id}`);
		expect(thread.name).toBe(threadName);
		expect(thread.owner_persona_id).toBe(fox.id);
		const threadMessages = await api<Array<any>>(alice.client, `/channels/${source.id}/messages?limit=50`);
		const sent = threadMessages.find((m) => m.content === firstText);
		expect(sent?.subprofile?.id).toBe(fox.id);

		// Alice opens the thread and sees it attributed to Fox.
		const aliceContext = await browser.newContext();
		try {
			const alicePage = await aliceContext.newPage();
			await loginAs(alicePage, alice.email, password);
			await alicePage.goto(`/channels/${guild.id}/${channel.id}/threads/${source.id}`);
			await expect(startedBy(alicePage)).toHaveText(`Started by ${fox.name}`, {timeout: 20_000});
			await expect(messageArticle(panel(alicePage), firstText).getByText(fox.name, {exact: true})).toBeVisible({
				timeout: 15_000,
			});
		} finally {
			await aliceContext.close();
		}
	});
});
