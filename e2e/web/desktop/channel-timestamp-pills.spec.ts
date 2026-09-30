import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Rich Composer Timestamp Pills & Formatting', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can open timestamp modal, insert rich timestamp pill into composer, and send formatted timestamp', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const email = `time_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `time_${timestamp}`;
		await client.register({
			username,
			email,
			password,
			global_name: 'Time Tester',
		});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Time Guild ${timestamp}`);
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

		await loginAs(page, email, password);
		await page.goto(`/channels/${guildId}/${channelId}`);

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});

		// 1. Click plus button next to composer
		const plusButton = page.locator('flx-channel-textarea-upload-column button').first();
		await expect(plusButton).toBeVisible({timeout: 10_000});
		await plusButton.click();

		// 2. Select "Insert timestamp" menu item
		const timestampMenuItem = page.getByRole('menuitem', {name: /Insert timestamp/i});
		await expect(timestampMenuItem).toBeVisible({timeout: 5_000});
		await timestampMenuItem.click();

		// 3. Verify TimestampModal opens
		await expect(page.getByText(/Insert timestamp/i).first()).toBeVisible({timeout: 5_000});

		// 4. Click Insert button
		const insertBtn = page.getByRole('button', {name: /^Insert$/i});
		await expect(insertBtn).toBeVisible({timeout: 5_000});
		await insertBtn.click();

		// 5. Verify timestamp pill appears in composer
		const timestampPill = page
			.locator('[data-flx*="composer-timestamp-pill"], [class*="timestampPill"], [contenteditable="false"]')
			.first();
		await expect(timestampPill).toBeVisible({timeout: 5_000});

		// 6. Submit message
		const sendButton = page
			.locator(
				'[data-flx="channel.textarea.textarea-buttons.textarea-button.submit"], button[aria-label*="Send message" i]',
			)
			.first();
		if (await sendButton.isVisible({timeout: 2_000}).catch(() => false)) {
			await sendButton.click();
		} else {
			await page.keyboard.press('Enter');
		}

		// 7. Verify message renders with formatted timestamp element
		const renderedTimestamp = page.locator('time, [class*="timestamp"], [data-flx*="timestamp-renderer"]').first();
		await expect(renderedTimestamp).toBeVisible({timeout: 15_000});

		// 8. Hover over timestamp to verify tooltip
		await renderedTimestamp.hover();
		const tooltip = page.locator('[role="tooltip"], [data-flx*="tooltip"]').first();
		await expect(tooltip).toBeVisible({timeout: 5_000});
	});
});
