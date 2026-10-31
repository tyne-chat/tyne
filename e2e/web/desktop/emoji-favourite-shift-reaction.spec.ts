import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// Fork: Shift keeps the emoji picker open to react several times, and a favourite can be dragged to
// reorder it. Over a custom emoji, which is an image, the browser starts a drag a few pixels into a
// Shift press, and the click that adds the reaction never comes (tyne-chat/tyne#119). Only a real
// browser does this, and a press without any movement does not show it.
function readSeed(): Record<string, string> {
	const content = readFileSync(resolve(process.cwd(), '.env.test'), 'utf-8');
	const seed: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) seed[match[1]] = match[2];
	}
	return seed;
}

const EMOJI_NAME = 'e2e_shift_favourite';
const MOVEMENT_PX = 8;

async function pressWithShift(page: Page, selector: string): Promise<void> {
	const box = await page.locator(selector).first().boundingBox();
	if (!box) throw new Error('The favourite is not on screen');
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.keyboard.down('Shift');
	await page.mouse.down();
	await page.mouse.move(x + MOVEMENT_PX, y + 1, {steps: 6});
	await page.mouse.up();
	await page.keyboard.up('Shift');
}

test.describe('Reacting with a favourite custom emoji', () => {
	const seed = readSeed();
	const client = new FluxerApiClient(seed.E2E_BASE_URL, seed.E2E_ALICE_TOKEN);

	async function api(method: string, path: string, body?: unknown): Promise<Response> {
		const response = await fetch(`${seed.E2E_BASE_URL}/api/v1${path}`, {
			method,
			headers: {'Content-Type': 'application/json', Authorization: seed.E2E_ALICE_TOKEN},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		expect(response.ok, `${method} ${path}: ${response.status}`).toBe(true);
		return response;
	}

	test('a Shift press with a little movement adds the reaction and keeps the picker open', async ({page}) => {
		const image = readFileSync(resolve(process.cwd(), 'fixtures/avatar.png')).toString('base64');
		const emoji = (await (
			await api('POST', `/guilds/${seed.E2E_GUILD_ID}/emojis`, {
				name: EMOJI_NAME,
				image: `data:image/png;base64,${image}`,
			})
		).json()) as {id: string};
		try {
			const content = `shift favourite ${Date.now()}`;
			const message = await client.sendMessage(seed.E2E_CHANNEL_ID, content);

			await loginAs(page, seed.E2E_ALICE_EMAIL, seed.E2E_ALICE_PASSWORD);
			await page.goto(`/channels/${seed.E2E_GUILD_ID}/${seed.E2E_CHANNEL_ID}`);
			const row = page.getByText(content).last();
			await expect(row).toBeVisible({timeout: 20_000});
			await row.hover();
			await page.locator('[data-action="message-add-reaction-button"]').last().click();

			const cell = `[role="option"][aria-label="${EMOJI_NAME}"]`;
			const search = page.locator('[data-flx="channel.emoji-picker.emoji-picker-search-bar.container"] input').first();
			await search.fill(EMOJI_NAME);
			await page
				.locator(cell)
				.first()
				.click({modifiers: ['Alt']});
			await search.fill('');
			const favourite = `[data-flx*="emoji-renderer"][class*="favoriteEmoji"][aria-label="${EMOJI_NAME}"]`;
			await expect(page.locator(favourite).first()).toBeVisible({timeout: 10_000});

			await pressWithShift(page, favourite);

			await expect
				.poll(
					async () => {
						const fetched = (await client.getMessages(seed.E2E_CHANNEL_ID, 20)).find((m) => m.id === message.id);
						return (fetched?.reactions ?? []).map((reaction: {emoji: {id?: string}}) => reaction.emoji.id);
					},
					{timeout: 10_000},
				)
				.toEqual([emoji.id]);
			await expect(page.locator(favourite).first()).toBeVisible();
		} finally {
			await api('DELETE', `/guilds/${seed.E2E_GUILD_ID}/emojis/${emoji.id}`);
		}
	});
});
