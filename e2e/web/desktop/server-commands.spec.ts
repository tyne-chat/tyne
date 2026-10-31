import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, type Locator, type Page, test} from '@playwright/test';
import {loginAs} from '../support/auth.js';

// Fork: server commands from the message box to the message, in a real browser on a real server
// (docs/design/server-commands.md). Alice owns the shared guild, so she may edit its commands.
function readSeed(): Record<string, string> {
	const content = readFileSync(resolve(process.cwd(), '.env.test'), 'utf-8');
	const seed: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) seed[match[1]] = match[2];
	}
	return seed;
}

test.describe('Server commands', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const seed = readSeed();
	const unique = Date.now().toString().slice(-6);
	const WAVE = `wave-${unique}`;
	const GREET = `greet-${unique}`;
	const TALLY = `tally-${unique}`;
	const created: Array<string> = [];

	const api = async <T = unknown>(token: string, method: string, path: string, body?: unknown): Promise<T> => {
		const response = await fetch(`${baseURL}/api/v1${path}`, {
			method,
			headers: {'Content-Type': 'application/json', Authorization: token},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`API ${method} ${path} failed (${response.status}): ${await response.text()}`);
		}
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	};

	const composer = (page: Page): Locator =>
		page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();

	const chip = (page: Page, name: string): Locator => page.locator('button', {hasText: `/${name}`}).last();

	const channelPath = `/channels/${seed.E2E_GUILD_ID}/${seed.E2E_CHANNEL_ID}`;

	const send = async (page: Page, text: string) => {
		await composer(page).click();
		await page.keyboard.type(text);
		await page.keyboard.press('Enter');
	};

	/** A command with no input: the first Enter picks it from the list, the second sends it. */
	const sendBare = async (page: Page, name: string) => {
		await send(page, `/${name}`);
		await expect(composer(page)).toHaveText(`/${name}`);
		await page.keyboard.press('Enter');
	};

	test.beforeAll(async () => {
		for (const command of [
			{name: WAVE, template: '{{ person.name }} waves at {{ input }}', input_mode: 'required', description: 'Waves'},
			{
				name: TALLY,
				template: `run {{ runs }} of ${unique}`,
				input_mode: 'none',
				counters: [{name: 'runs', per: []}],
			},
			{
				name: GREET,
				template: `{% if target %}Hello {{ target.name }} ${unique}{% else %}Hello nobody ${unique}{% endif %}`,
				input_mode: 'optional',
			},
		]) {
			const {id} = await api<{id: string}>(
				seed.E2E_ALICE_TOKEN,
				'POST',
				`/guilds/${seed.E2E_GUILD_ID}/commands`,
				command,
			);
			created.push(id);
		}
	});

	test.afterAll(async () => {
		for (const id of created) {
			await api(seed.E2E_ALICE_TOKEN, 'DELETE', `/guilds/${seed.E2E_GUILD_ID}/commands/${id}`);
		}
	});

	test('a command runs from the message box, and everyone sees its chip', async ({page, browser}) => {
		await loginAs(page, seed.E2E_ALICE_EMAIL, seed.E2E_ALICE_PASSWORD);
		await page.goto(channelPath);
		await expect(composer(page)).toBeVisible({timeout: 20_000});

		const bobContext = await browser.newContext();
		const bobPage = await bobContext.newPage();
		try {
			await loginAs(bobPage, seed.E2E_BOB_EMAIL, seed.E2E_BOB_PASSWORD);
			await bobPage.goto(channelPath);
			await expect(composer(bobPage)).toBeVisible({timeout: 20_000});

			await send(page, `/${WAVE} the crowd ${unique}`);

			const message = `waves at the crowd ${unique}`;
			await expect(page.getByText(message).last()).toBeVisible({timeout: 15_000});
			await expect(chip(page, WAVE)).toBeVisible();
			await expect(bobPage.getByText(message).last()).toBeVisible({timeout: 15_000});
			await expect(chip(bobPage, WAVE)).toBeVisible();
		} finally {
			await bobContext.close();
		}
	});

	test('a counter goes up with each run', async ({page}) => {
		await loginAs(page, seed.E2E_ALICE_EMAIL, seed.E2E_ALICE_PASSWORD);
		await page.goto(channelPath);
		await expect(composer(page)).toBeVisible({timeout: 20_000});

		await sendBare(page, TALLY);
		await expect(page.getByText(`run 1 of ${unique}`).last()).toBeVisible({timeout: 15_000});
		await sendBare(page, TALLY);
		await expect(page.getByText(`run 2 of ${unique}`).last()).toBeVisible({timeout: 15_000});
	});

	test('a script is filled in by the server', async ({page}) => {
		await loginAs(page, seed.E2E_ALICE_EMAIL, seed.E2E_ALICE_PASSWORD);
		await page.goto(channelPath);
		await expect(composer(page)).toBeVisible({timeout: 20_000});

		await sendBare(page, GREET);

		await expect(page.getByText(`Hello nobody ${unique}`).last()).toBeVisible({timeout: 15_000});
		await expect(chip(page, GREET)).toBeVisible();
	});

	test("a chip puts its command in an empty message box, and right-clicking it opens the editor, whose preview is the server's", async ({
		page,
	}) => {
		await loginAs(page, seed.E2E_ALICE_EMAIL, seed.E2E_ALICE_PASSWORD);
		await page.goto(channelPath);
		await expect(composer(page)).toBeVisible({timeout: 20_000});
		await send(page, `/${WAVE} again ${unique}`);
		await expect(chip(page, WAVE)).toBeVisible({timeout: 15_000});

		await chip(page, WAVE).click();
		await expect(composer(page)).toHaveText(`/${WAVE}`);
		await page.keyboard.press('Control+A');
		await page.keyboard.press('Backspace');
		await expect(composer(page)).toHaveText('');

		await chip(page, WAVE).click({button: 'right'});
		await page.getByText(`Edit /${WAVE}`).click();
		const name = page.locator('[data-flx="guild-commands.guild-commands-tab.name"]');
		await expect(name).toHaveValue(WAVE, {timeout: 15_000});

		// Its template uses `person.name`, so it opens in the script editor.
		const script = page.locator('.cm-content[contenteditable="true"]').first();
		await script.click();
		await page.keyboard.press('Control+A');
		await page.keyboard.type(`{{ "preview ${unique}" | upcase }}`);

		await expect(page.getByText(`PREVIEW ${unique}`).last()).toBeVisible({timeout: 15_000});
	});
});
