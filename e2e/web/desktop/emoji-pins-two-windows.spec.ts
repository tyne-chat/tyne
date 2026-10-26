import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, type Page, test} from '@playwright/test';
import {loginAs} from '../support/auth.js';

// Fork: pinned emojis follow between two windows of one browser, pinned and unpinned in turn within
// the minute after each window's own save (tyne-chat/tyne#140, tyne-chat/tyne#236). Before #236 a
// window that had just saved ignored the other's changes and then overwrote them.
function readSeed(): Record<string, string> {
	const content = readFileSync(resolve(process.cwd(), '.env.test'), 'utf-8');
	const seed: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) seed[match[1]] = match[2];
	}
	return seed;
}

const EMOJI_BUTTON = '[data-flx="channel.textarea.textarea-buttons.textarea-button.expression-picker-toggle--4"]';
const EMOJI_CELL = '[data-flx="channel.emoji-picker.virtual-row.virtual-row-renderer.emoji-renderer"]';
const PINNED_BADGE = '[data-flx="channel.emoji-picker.emoji-renderer.pinned-badge"]';

async function openPicker(page: Page): Promise<void> {
	await page.bringToFront();
	if ((await page.locator(EMOJI_CELL).count()) === 0) await page.locator(EMOJI_BUTTON).click();
	await expect(page.locator(EMOJI_CELL).first()).toBeVisible({timeout: 20_000});
}

/** The names of the emojis the picker shows as pinned, sorted. */
async function pinned(page: Page): Promise<Array<string>> {
	await openPicker(page);
	const names = await page
		.locator(EMOJI_CELL)
		.evaluateAll(
			(cells, badge) => cells.filter((c) => c.querySelector(badge)).map((c) => c.getAttribute('aria-label') ?? ''),
			PINNED_BADGE,
		);
	return [...new Set(names)].sort();
}

async function choose(page: Page, emoji: string, action: 'Pin emoji' | 'Unpin emoji'): Promise<void> {
	await openPicker(page);
	await page.locator(`${EMOJI_CELL}[aria-label="${emoji}"]`).first().click({button: 'right'});
	await page.getByText(action, {exact: true}).click();
}

test.describe('Pinned emojis in two windows', () => {
	const seed = readSeed();

	test('pins and unpins made in either window show in both', async ({browser}) => {
		const context = await browser.newContext();
		const first = await context.newPage();
		const second = await context.newPage();
		const both = async (expected: Array<string>) => {
			await expect.poll(() => pinned(first), {timeout: 15_000}).toEqual(expected);
			await expect.poll(() => pinned(second), {timeout: 15_000}).toEqual(expected);
		};
		try {
			const channelPath = `/channels/${seed.E2E_GUILD_ID}/${seed.E2E_CHANNEL_ID}`;
			await loginAs(first, seed.E2E_CAROL_EMAIL, seed.E2E_CAROL_PASSWORD);
			await first.goto(channelPath);
			await second.goto(channelPath);
			await both([]);

			await choose(first, 'wink', 'Pin emoji');
			await both(['wink']);
			// The unpin brings the pins back to what they were before the pin.
			await choose(second, 'wink', 'Unpin emoji');
			await both([]);
			await choose(second, 'blush', 'Pin emoji');
			await both(['blush']);
			await choose(first, 'blush', 'Unpin emoji');
			await both([]);
			await choose(first, 'wink', 'Pin emoji');
			await choose(first, 'blush', 'Pin emoji');
			await both(['blush', 'wink']);
			await choose(second, 'wink', 'Unpin emoji');
			await both(['blush']);
			await choose(first, 'blush', 'Unpin emoji');
			await both([]);
		} finally {
			await context.close();
		}
	});
});
