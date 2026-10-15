import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openUserSettings} from '../support/auth.js';

// Playwright reports every page as focused, so the window's focus changes are simulated: blur by
// making document.hasFocus() return false and firing `blur`, focus by restoring it and firing `focus`.
async function blurWindow(page: Page): Promise<void> {
	await page.evaluate(() => {
		document.hasFocus = () => false;
		window.dispatchEvent(new Event('blur'));
	});
	await expect(page.locator('html')).not.toHaveClass(/(^|\s)window-focused(\s|$)/);
}

// The window gains focus from the click itself: focus arrives with the pointerdown, as it does
// when a user clicks an inactive window.
async function focusWindowOnNextPointerDown(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.addEventListener(
			'pointerdown',
			() => {
				delete (document as {hasFocus?: unknown}).hasFocus;
				window.dispatchEvent(new Event('focus'));
			},
			{capture: true, once: true},
		);
	});
}

test.describe('Clicking into an unfocused window (tyne-chat/tyne#94)', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('the click that focuses the window reacts with the quick reaction under the pointer', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const email = `unfocused_react_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		await client.register({
			username: `unfocused_${timestamp}`,
			email,
			password,
			global_name: 'Unfocused Reactor',
		});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Unfocused Guild ${timestamp}`);
			guildId = guild.id;
			const channels = await client.getGuildChannels(guildId);
			const channel = channels.find((c) => c.type === 0) || channels[0];
			channelId = channel.id;
		} catch (err: any) {
			if (err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
				const guilds = await client.getMyGuilds();
				guildId = guilds[0].id;
				const channels = await client.getGuildChannels(guildId);
				const channel = channels.find((c) => c.type === 0) || channels[0];
				channelId = channel.id;
			} else {
				throw err;
			}
		}

		const messageText = `React to me from another window [${timestamp}]`;
		await client.sendMessage(channelId, messageText);

		await loginAs(page, email, password);

		// Turn on "Stay fully interactive when unfocused", which keeps the action bar showing on hover.
		await openUserSettings(page);
		const accessibilityTab = page
			.locator('[data-flx*="sidebar-item"], [data-flx*="settings-item"], [data-flx*="tab-select"], button, div')
			.filter({hasText: /^Accessibility$/i})
			.first();
		await expect(accessibilityTab).toBeVisible({timeout: 10_000});
		await accessibilityTab.click();
		const stayInteractive = page.getByRole('switch', {name: 'Stay fully interactive when unfocused'}).first();
		await stayInteractive.scrollIntoViewIfNeeded();
		await expect(stayInteractive).toHaveAttribute('aria-checked', 'false');
		await stayInteractive.click();
		await expect(stayInteractive).toHaveAttribute('aria-checked', 'true');
		await expect(page.locator('html')).toHaveClass(/(^|\s)unfocused-fully-interactive(\s|$)/);
		await page.keyboard.press('Escape');
		await expect(stayInteractive).toBeHidden({timeout: 5_000});

		await page.goto(`/channels/${guildId}/${channelId}`);
		const messageContent = page.locator('[data-flx*="message-content"]').filter({hasText: messageText}).first();
		await expect(messageContent).toBeVisible({timeout: 20_000});
		const messageArticle = page.locator('role=article').filter({has: messageContent}).first();
		const reactionButton = messageArticle.locator(
			'button[data-flx*="channel.message-reactions.message-reaction-item.reaction-button"]',
		);
		await expect(reactionButton).toHaveCount(0);

		await blurWindow(page);
		await messageContent.hover();
		const quickReaction = messageArticle.locator('button[aria-label*="React with" i]').first();
		await expect(quickReaction).toBeVisible({timeout: 10_000});

		await focusWindowOnNextPointerDown(page);
		await quickReaction.click();

		await expect(page.locator('html')).toHaveClass(/(^|\s)window-focused(\s|$)/);
		await expect(reactionButton).toHaveCount(1, {timeout: 10_000});
	});
});
