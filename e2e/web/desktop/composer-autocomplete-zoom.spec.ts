import {expect, type Locator, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

// tyne-chat/tyne#636: the app zooms by its root font size (`--custom-zoom`), so rem sizes grow with it and
// px sizes do not. A fixed px cap on the autocomplete box hid the bottom of the list, which keeps its own
// cap in rem: from about 100% zoom up, the last rows could not be scrolled into view.
test.describe('Composer autocomplete at app zoom', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test.use({viewport: {width: 1400, height: 1000}});

	async function openChannelComposer(page: Page): Promise<Locator> {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `zoom_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		await client.register({username: `zoom_${timestamp}`, email, password, global_name: 'Zoom Tester'});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Zoom Guild ${timestamp}`);
			guildId = guild.id;
			const channels = await client.getGuildChannels(guildId);
			channelId = (channels.find((c) => c.type === 0) || channels[0]).id;
		} catch (err: any) {
			if (!err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) throw err;
			const guilds = await client.getMyGuilds();
			guildId = guilds[0].id;
			const channels = await client.getGuildChannels(guildId);
			channelId = (channels.find((c) => c.type === 0) || channels[0]).id;
		}

		await loginAs(page, email, password);
		await page.goto(`/channels/${guildId}/${channelId}`);
		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});
		return composer;
	}

	// Scrolls the list to its end and reports how many px of the last row the box hides, and where the box is.
	async function lastRowAtTheEnd(page: Page) {
		return page.evaluate(() => {
			const box = document.querySelector('[data-flx="channel.autocomplete.container.key-down"]');
			const scroller = box?.querySelector<HTMLElement>('[data-fluxer-scroll-container="true"]');
			const options = box?.querySelectorAll('[role="option"]');
			if (!box || !scroller || !options || options.length === 0) return null;
			scroller.scrollTop = scroller.scrollHeight;
			const boxRect = box.getBoundingClientRect();
			const innerBottom = boxRect.bottom - Number.parseFloat(getComputedStyle(box).borderBottomWidth);
			const last = options[options.length - 1].getBoundingClientRect();
			return {
				options: options.length,
				hiddenPx: Math.max(0, Math.round(last.bottom - innerBottom)),
				boxTop: Math.round(boxRect.top),
				atEnd: Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight,
			};
		});
	}

	for (const zoom of [100, 140, 175]) {
		test(`the last emoji suggestion can be scrolled fully into view at ${zoom}% zoom`, async ({page}) => {
			const composer = await openChannelComposer(page);
			// As the desktop app's zoom does it (AppZoomUtils).
			await page.evaluate((value) => document.documentElement.style.setProperty('--custom-zoom', String(value)), zoom);

			await composer.click();
			await page.keyboard.type(':sm');
			const box = page.locator('[data-flx="channel.autocomplete.container.key-down"]');
			await expect(box).toBeVisible({timeout: 10_000});
			// More suggestions than fit, so the list scrolls.
			await expect.poll(async () => (await lastRowAtTheEnd(page))?.options ?? 0).toBeGreaterThan(20);

			await expect
				.poll(async () => {
					const result = await lastRowAtTheEnd(page);
					return result === null ? null : {hiddenPx: result.hiddenPx, atEnd: result.atEnd};
				})
				.toEqual({hiddenPx: 0, atEnd: true});
			const result = await lastRowAtTheEnd(page);
			expect(result?.boxTop).toBeGreaterThanOrEqual(0);
		});
	}
});
