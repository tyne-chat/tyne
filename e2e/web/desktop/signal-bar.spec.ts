import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, type Page, test} from '@playwright/test';
import {loginAs} from '../support/auth.js';

// The seed step registers Alice first, which makes her the bootstrap admin of the
// self-hosted e2e instance and the owner of the shared guild. That is what lets
// this spec choose the signal bar's home community and edit the bar.
function readSeed(): Record<string, string> {
	const content = readFileSync(resolve(process.cwd(), '.env.test'), 'utf-8');
	const seed: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) seed[match[1]] = match[2];
	}
	return seed;
}

test.describe('Signal Bar', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const seed = readSeed();

	const api = async (token: string, method: string, path: string, body?: unknown): Promise<void> => {
		const response = await fetch(`${baseURL}/api/v1${path}`, {
			method,
			headers: {'Content-Type': 'application/json', Authorization: token},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`API ${method} ${path} failed (${response.status}): ${await response.text()}`);
		}
	};

	const setEverywhere = (enabled: boolean) =>
		api(seed.E2E_ALICE_TOKEN, 'PUT', `/guilds/${seed.E2E_GUILD_ID}/signal-bar/channels`, {
			default: enabled,
			categories: {},
			channels: {},
		});

	const signal = (page: Page, label: string) =>
		page.getByRole('toolbar', {name: 'Signal bar'}).locator(`button[aria-label^="${label}"]`);

	test.beforeAll(async () => {
		await api(seed.E2E_ALICE_TOKEN, 'PATCH', '/admin/instance/config', {
			policy: {signal_bar_guild_id: seed.E2E_GUILD_ID},
		});
		await api(seed.E2E_ALICE_TOKEN, 'PUT', '/instance/signal-bar', {
			signals: [
				{emoji_name: '📖', label: 'Reading'},
				{emoji_name: '✅', label: 'Done'},
			],
		});
		// The bar is off in every channel until a community manager switches it on.
		await setEverywhere(true);
	});

	test.afterAll(async () => {
		await setEverywhere(false);
		await api(seed.E2E_ALICE_TOKEN, 'PUT', '/instance/signal-bar', {signals: []});
	});

	test('signals toggle in real time, follow the active persona, and are managed per channel', async ({
		page,
		browser,
	}) => {
		const channelPath = `/channels/${seed.E2E_GUILD_ID}/${seed.E2E_CHANNEL_ID}`;

		await loginAs(page, seed.E2E_ALICE_EMAIL, seed.E2E_ALICE_PASSWORD);
		await page.goto(channelPath);
		await expect(signal(page, 'Reading')).toBeVisible({timeout: 20_000});
		await expect(signal(page, 'Done')).toHaveAttribute('aria-label', 'Done');

		const bobContext = await browser.newContext();
		const bobPage = await bobContext.newPage();
		try {
			await loginAs(bobPage, seed.E2E_BOB_EMAIL, seed.E2E_BOB_PASSWORD);
			await bobPage.goto(channelPath);
			await expect(signal(bobPage, 'Reading')).toBeVisible({timeout: 20_000});

			// Bob turns Reading on as his account: both sides light up and name him.
			await signal(bobPage, 'Reading').click();
			await expect(signal(bobPage, 'Reading')).toHaveAttribute('aria-pressed', 'true');
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', /^Reading: Bob Multi/);
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-pressed', 'false');
			await expect(signal(page, 'Done')).toHaveAttribute('aria-label', 'Done');

			// The signal follows whoever Bob is right now: typing a persona tag in the
			// composer switches it to that persona without another click.
			const bobComposer = bobPage
				.locator(
					'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
				)
				.first();
			await bobComposer.click();
			await bobPage.keyboard.type('a: reading along');
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', 'Reading: Bob-Alpha');
			await expect(signal(bobPage, 'Reading')).toHaveAttribute('aria-pressed', 'true');

			// Clearing the tag switches it back to the account.
			await bobPage.keyboard.press('Control+A');
			await bobPage.keyboard.press('Backspace');
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', /^Reading: Bob Multi/);

			// Clicking again turns it off for everyone.
			await signal(bobPage, 'Reading').click();
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', 'Reading');
			await expect(signal(bobPage, 'Reading')).toHaveAttribute('aria-pressed', 'false');

			// Only managers get the signal menu. Bob's right-click opens nothing.
			await signal(bobPage, 'Reading').click();
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', /^Reading: Bob Multi/);
			await signal(bobPage, 'Reading').click({button: 'right'});
			await expect(bobPage.getByText('Reset signal for everyone')).toHaveCount(0);

			// Alice manages the community, so she can turn Bob's signal off...
			await signal(page, 'Reading').click({button: 'right'});
			await page.getByText(/^Turn off Bob Multi/).click();
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', 'Reading');
			await expect(signal(bobPage, 'Reading')).toHaveAttribute('aria-pressed', 'false');

			// ...or reset the signal for everyone.
			await signal(bobPage, 'Reading').click();
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', /^Reading: Bob Multi/);
			await signal(page, 'Reading').click({button: 'right'});
			await page.getByText('Reset signal for everyone').click();
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', 'Reading');
			await expect(signal(bobPage, 'Reading')).toHaveAttribute('aria-label', 'Reading');

			// Switching the bar off for the community hides it for everyone straight away,
			// and switching it back on brings it back with nothing lit.
			await signal(bobPage, 'Reading').click();
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', /^Reading: Bob Multi/);
			await setEverywhere(false);
			await expect(signal(bobPage, 'Reading')).toHaveCount(0);
			await expect(signal(page, 'Reading')).toHaveCount(0);
			await setEverywhere(true);
			await expect(signal(bobPage, 'Reading')).toBeVisible();
			await expect(signal(page, 'Reading')).toHaveAttribute('aria-label', 'Reading');
		} finally {
			await bobContext.close();
		}
	});
});
