import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, type Page, test} from '@playwright/test';
import {loginAs} from '../support/auth.js';

// Uses the seeded accounts: Alice owns the shared guild, Bob has the personas Bob-Alpha and
// Bob-Beta. Bob switches to having his persona remembered per channel for the test and back
// afterwards, so the other specs keep seeing one persona for every channel.
function readSeed(): Record<string, string> {
	const content = readFileSync(resolve(process.cwd(), '.env.test'), 'utf-8');
	const seed: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) seed[match[1]] = match[2];
	}
	return seed;
}

test.describe('Persona remembered per channel', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const seed = readSeed();
	let otherChannelId = '';
	const otherChannelName = `persona-scope-${Date.now().toString().slice(-6)}`;

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

	const clearBobsChannels = async () => {
		for (const channelId of [seed.E2E_CHANNEL_ID, otherChannelId]) {
			if (channelId) {
				await api(seed.E2E_BOB_TOKEN, 'PUT', `/users/@me/personas/channel-states/${channelId}`, {persona_id: null});
			}
		}
	};

	test.beforeAll(async () => {
		const channel = await api<{id: string}>(seed.E2E_ALICE_TOKEN, 'POST', `/guilds/${seed.E2E_GUILD_ID}/channels`, {
			name: otherChannelName,
			type: 0,
		});
		otherChannelId = channel.id;
		await api(seed.E2E_BOB_TOKEN, 'PATCH', '/users/@me/personas/settings', {
			active_persona_scope: 'channel',
			active_persona_mode: 'manual',
			active_persona_id: null,
			is_latched: false,
		});
		await clearBobsChannels();
	});

	test.afterAll(async () => {
		await clearBobsChannels();
		await api(seed.E2E_BOB_TOKEN, 'PATCH', '/users/@me/personas/settings', {active_persona_scope: 'global'});
		if (otherChannelId) await api(seed.E2E_ALICE_TOKEN, 'DELETE', `/channels/${otherChannelId}`);
	});

	const pill = (page: Page) => page.locator('[data-flx="persona.composer-pill"] button').first();

	const pick = async (page: Page, name: RegExp) => {
		await pill(page).click();
		const sheet = page.locator('[data-flx="persona.picker-sheet"]');
		await expect(sheet.locator('[data-flx="persona.picker-sheet.scope-note"]')).toBeVisible();
		await sheet.getByText(name).first().click();
	};

	const open = async (page: Page, name: string, channelId: string) => {
		await page
			.locator('[data-flx="app.channel-item-content.channel-name"]')
			.filter({hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)})
			.first()
			.click();
		await page.waitForURL(`**/channels/${seed.E2E_GUILD_ID}/${channelId}`);
	};

	test('each channel keeps its own persona, across a reload and across windows', async ({page, context}) => {
		const here = await api<{name: string}>(seed.E2E_ALICE_TOKEN, 'GET', `/channels/${seed.E2E_CHANNEL_ID}`);
		const herePath = `/channels/${seed.E2E_GUILD_ID}/${seed.E2E_CHANNEL_ID}`;
		const otherPath = `/channels/${seed.E2E_GUILD_ID}/${otherChannelId}`;

		await loginAs(page, seed.E2E_BOB_EMAIL, seed.E2E_BOB_PASSWORD);
		await page.goto(herePath);
		await expect(pill(page)).toBeVisible({timeout: 20_000});

		// Every channel starts as the account.
		await expect(pill(page)).toHaveAttribute('aria-label', /^Sending as @/);

		// A persona picked here is this channel's alone.
		await pick(page, /^Bob-Alpha$/);
		await expect(pill(page)).toHaveAttribute('aria-label', /Bob-Alpha/);

		await open(page, otherChannelName, otherChannelId);
		await expect(pill(page)).toHaveAttribute('aria-label', /^Sending as @/);
		await pick(page, /^Bob-Beta$/);
		await expect(pill(page)).toHaveAttribute('aria-label', /Bob-Beta/);

		await open(page, here.name, seed.E2E_CHANNEL_ID);
		await expect(pill(page)).toHaveAttribute('aria-label', /Bob-Alpha/);

		// An untagged message goes out as this channel's persona.
		const text = `scoped hello ${Date.now().toString().slice(-6)}`;
		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await composer.click();
		await page.keyboard.type(text);
		await page.keyboard.press('Enter');
		const sent = page.locator('[data-message-id]').filter({hasText: text}).last();
		await expect(sent).toBeVisible({timeout: 15_000});
		await expect(sent).toContainText('Bob-Alpha');

		// The selections live on the server: a fresh load of the app finds them again.
		await page.goto(otherPath);
		await expect(pill(page)).toHaveAttribute('aria-label', /Bob-Beta/, {timeout: 20_000});

		// A second window of the same account follows a pick made in the first.
		const second = await context.newPage();
		await second.goto(herePath);
		await expect(pill(second)).toHaveAttribute('aria-label', /Bob-Alpha/, {timeout: 20_000});
		await open(page, here.name, seed.E2E_CHANNEL_ID);
		await pick(page, /Root Account/i);
		await expect(pill(page)).toHaveAttribute('aria-label', /^Sending as @/);
		await expect(pill(second)).toHaveAttribute('aria-label', /^Sending as @/);
		// The other channel is untouched by that.
		await open(second, otherChannelName, otherChannelId);
		await expect(pill(second)).toHaveAttribute('aria-label', /Bob-Beta/);
		await second.close();
	});
});
