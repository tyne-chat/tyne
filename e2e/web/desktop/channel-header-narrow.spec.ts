import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// tyne-chat/tyne#233: in a narrow window the channel header keeps the channel's name and the sidebar
// toggle visible; the search box collapses to a magnifier and actions move into "More options".
test.describe('Channel header in a narrow window', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';
	const header = (page: Page) =>
		page.locator('[data-flx="channel.channel-header.header-wrapper"]').locator('[data-header-overflow]');
	const moreButton = (page: Page) => page.locator('[data-flx="channel.header-overflow.more"]');
	const channelName = (page: Page) => page.locator('[data-flx^="channel.channel-header.channel-name"]').first();
	const toggle = (page: Page) => page.locator('[data-flx="channel.channel-header.toggle-channels"]');

	async function openChannel(page: Page, name: string, topic?: string): Promise<void> {
		const stamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `header_${stamp}@test.local`;
		await client.register({username: `header_${stamp}`, email, password: 'TestPassword123!', global_name: 'Header'});
		let guildId: string;
		try {
			guildId = (await client.createGuild(`Header Guild ${stamp}`)).id;
		} catch (err: any) {
			if (!err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) throw err;
			guildId = (await client.getMyGuilds())[0].id;
		}
		const channel = await client.createGuildChannel(guildId, {name, topic});
		await page.setViewportSize({width: 1400, height: 900});
		await loginAs(page, email);
		await page.goto(`/channels/${guildId}/${channel.id}`);
		await expect(header(page)).toBeVisible({timeout: 20_000});
		await expect(channelName(page)).toBeVisible();
	}

	const openLongChannel = (page: Page) =>
		openChannel(
			page,
			'tyne-technical-support-header-test',
			'For Tyne development and reporting bugs and feature requests!',
		);

	// The name keeps at least 10rem (or its whole length), nothing in the action row covers the
	// sidebar toggle, and no icon left in the row is cut off at its edge.
	async function expectNameAndToggleClear(page: Page): Promise<void> {
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const name = document.querySelector('[data-flx^="channel.channel-header.channel-name"]') as HTMLElement;
					const toggleRect = document
						.querySelector('[data-flx="channel.channel-header.toggle-channels"]')!
						.getBoundingClientRect();
					const row = document.querySelector('[data-flx="channel.channel-header.header-right-section"]')!;
					const shown = Array.from(row.children).filter(
						(child) => !child.hasAttribute('data-header-folded') && child.getBoundingClientRect().width > 0,
					);
					const rowStart = Math.min(...shown.map((child) => child.getBoundingClientRect().left));
					const rowRect = row.getBoundingClientRect();
					const uncut = shown.every((child) => {
						const rect = child.getBoundingClientRect();
						return rect.left >= rowRect.left - 0.5 && rect.right <= rowRect.right + 0.5;
					});
					const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
					const allFolded = shown.length === 1;
					const nameOk = allFolded || name.clientWidth >= Math.min(name.scrollWidth, 10 * rem) - 1;
					return nameOk && uncut && toggleRect.right <= rowStart;
				}),
			)
			.toBe(true);
	}

	test('keeps the name visible and folds actions into More options', async ({page}) => {
		await openLongChannel(page);
		await expect(moreButton(page)).toHaveCount(0);
		await expect(header(page)).toHaveAttribute('data-header-search', 'full');

		await page.setViewportSize({width: 900, height: 900});
		await expect(moreButton(page)).toBeVisible();
		await expect(header(page)).toHaveAttribute('data-header-search', 'icon');
		await expectNameAndToggleClear(page);

		await page.setViewportSize({width: 760, height: 900});
		await expectNameAndToggleClear(page);
		await expect(toggle(page)).toBeVisible();

		// A folded action opens from the menu, at the menu button, and focus comes back to it.
		await moreButton(page).focus();
		await page.keyboard.press('Enter');
		const pins = page.getByRole('menuitem', {name: /Pinned messages/i});
		await expect(pins).toBeVisible();
		await pins.press('Enter');
		const popout = page.locator('[data-flx="channel.channel-pins-popout.container"]');
		await expect(popout).toBeVisible();
		const [popoutBox, moreBox] = [await popout.boundingBox(), await moreButton(page).boundingBox()];
		// The popout keeps its own small offset from the edge of what it is anchored to.
		expect(Math.abs(popoutBox!.x + popoutBox!.width - (moreBox!.x + moreBox!.width))).toBeLessThan(12);
		await page.keyboard.press('Escape');
		await expect(popout).toHaveCount(0);
		await expect(moreButton(page)).toBeFocused();

		// Wide again, everything is back in the row.
		await page.setViewportSize({width: 1400, height: 900});
		await expect(moreButton(page)).toHaveCount(0);
		await expect(header(page)).toHaveAttribute('data-header-search', 'full');
	});

	// A short name needs less room than the stylesheet's 10rem fallback; the row must still get all
	// it was measured to need (the first icon was cut off at some widths before this was fixed).
	test('never cuts off an icon beside a short name', async ({page}) => {
		await openChannel(page, 'testing4');
		for (const width of [1200, 1100, 1000, 950, 900, 850, 800, 750, 700, 650]) {
			await page.setViewportSize({width, height: 900});
			await expectNameAndToggleClear(page);
		}
	});

	test('opens the collapsed search box over the icons, never over the sidebar toggle', async ({page}) => {
		await openLongChannel(page);
		await page.setViewportSize({width: 760, height: 900});
		await expect(header(page)).toHaveAttribute('data-header-search', 'icon');
		await page.locator('[data-flx="channel.channel-header.left-content-container"]').click();
		await page.keyboard.press('ControlOrMeta+f');
		const input = page.locator('[data-flx="channel.message-search-bar.message-search-bar.input.text"]');
		await expect(input).toBeFocused();
		await expect(header(page)).toHaveAttribute('data-header-search-open', '');
		const [inputBox, toggleBox] = [await input.boundingBox(), await toggle(page).boundingBox()];
		expect(inputBox!.x).toBeGreaterThanOrEqual(toggleBox!.x + toggleBox!.width);
		// The open box lies over the name, so leave it by moving focus away rather than clicking there.
		await input.blur();
		await expect(header(page)).not.toHaveAttribute('data-header-search-open', '');
	});

	// tyne-chat/tyne#518: clicking away collapses the box and hides its ✕ while the results stay
	// open, so the results panel has a close of its own that clears the search like the box's ✕.
	test('closes the search from the results panel once the box has collapsed', async ({page}) => {
		await openLongChannel(page);
		await page.setViewportSize({width: 760, height: 900});
		await expect(header(page)).toHaveAttribute('data-header-search', 'icon');
		await page.locator('[data-flx="channel.channel-header.left-content-container"]').click();
		await page.keyboard.press('ControlOrMeta+f');
		const input = page.locator('[data-flx="channel.message-search-bar.message-search-bar.input.text"]');
		await expect(input).toBeFocused();
		await page.keyboard.type('anything');
		await page.keyboard.press('Enter');
		const results = page.locator('[data-flx="channel.channel-search-results.container"]');
		const close = page.locator('[data-flx="channel.search-results-close-button.button"]');
		await expect(close).toBeVisible();

		const resultsBox = await results.boundingBox();
		await results.click({position: {x: resultsBox!.width / 2, y: resultsBox!.height - 20}});
		await expect(header(page)).not.toHaveAttribute('data-header-search-open', '');
		await expect(results).toBeVisible();

		await close.click();
		await expect(results).toHaveCount(0);
		await expect(input).toHaveText('');
		await expect(page.locator('flx-channel-textarea-composer [contenteditable="true"]')).toBeFocused();
	});
});
