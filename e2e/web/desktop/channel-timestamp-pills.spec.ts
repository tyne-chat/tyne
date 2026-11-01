import {expect, type Page, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Rich Composer Timestamp Pills & Formatting', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	async function openChannelComposer(page: Page) {
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
		return composer;
	}

	const composerPlusButton = (page: Page) => page.locator('flx-channel-textarea-upload-column button').first();
	const editPlusButton = (page: Page) => page.locator('[data-flx="channel.inline-edit-controls.textarea-button.plus"]');
	const timestampMenuItem = (page: Page) => page.getByRole('menuitem', {name: /Insert timestamp/i});
	const modalCancelButton = (page: Page) => page.locator('[data-flx="channel.timestamp-modal.button.cancel"]');

	async function insertTimestampFrom(page: Page, plusButton: ReturnType<Page['locator']>) {
		await plusButton.click();
		await timestampMenuItem(page).click();
		await page.getByRole('button', {name: /^Insert$/i}).click();
	}

	async function openInlineEditOfNewMessage(page: Page, composer: ReturnType<Page['locator']>, content: string) {
		await composer.click();
		await page.keyboard.type(content);
		await page.keyboard.press('Enter');
		await expect(page.getByText(content)).toBeVisible({timeout: 15_000});

		await composer.click();
		await page.keyboard.press('ArrowUp');
		const editor = page.locator(
			'[data-flx="channel.editing-message-input.textarea-container"] [contenteditable="true"]',
		);
		await expect(editor).toBeFocused({timeout: 10_000});
		return editor;
	}

	const pill = '[data-lexical-composer-timestamp]';

	test('user can open timestamp modal, insert rich timestamp pill into composer, and send formatted timestamp', async ({
		page,
	}) => {
		await openChannelComposer(page);

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

	test("the edit's own plus menu inserts at the edit's caret, and Enter saves it", async ({page}) => {
		const composer = await openChannelComposer(page);
		const editor = await openInlineEditOfNewMessage(page, composer, 'before after');

		await page.keyboard.press('Home');
		for (const _ of 'before ') {
			await page.keyboard.press('ArrowRight');
		}
		await insertTimestampFrom(page, editPlusButton(page));

		await expect(editor.locator(pill)).toHaveCount(1);
		await expect(composer.locator(pill)).toHaveCount(0);
		await expect(editor).toHaveText(/^before .+after$/);

		// The caret is back in the edit, so what follows does not go to the channel composer.
		await expect(editor).toBeFocused();
		await page.keyboard.type('more ');
		await expect(editor).toHaveText(/^before .+more after$/);
		await page.keyboard.press('Enter');

		await expect(editor).toBeHidden({timeout: 10_000});
		await expect(page.getByText(/before .+more after/)).toBeVisible({timeout: 10_000});
	});

	test("closing either plus menu or the timestamp modal without inserting keeps the edit's caret", async ({page}) => {
		const composer = await openChannelComposer(page);
		const editor = await openInlineEditOfNewMessage(page, composer, 'before after');

		await page.keyboard.press('Home');
		for (const _ of 'before ') {
			await page.keyboard.press('ArrowRight');
		}

		await editPlusButton(page).click();
		await expect(timestampMenuItem(page)).toBeVisible({timeout: 5_000});
		await page.keyboard.press('Escape');
		await expect(editor).toBeFocused();
		await page.keyboard.type('a');
		await expect(editor).toHaveText('before aafter');

		await editPlusButton(page).click();
		await timestampMenuItem(page).click();
		await modalCancelButton(page).click();
		await expect(editor).toBeFocused();
		await page.keyboard.type('b');
		await expect(editor).toHaveText('before abafter');

		await composerPlusButton(page).click();
		await expect(timestampMenuItem(page)).toBeVisible({timeout: 5_000});
		await page.keyboard.press('Escape');
		await expect(editor).toBeFocused();
		await page.keyboard.type('c');
		await expect(editor).toHaveText('before abcafter');

		await composerPlusButton(page).click();
		await timestampMenuItem(page).click();
		await expect(modalCancelButton(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(editor).toBeFocused();
		await page.keyboard.type('d');
		await expect(editor).toHaveText('before abcdafter');

		await expect(composer).toHaveText('');
	});

	test("the channel composer's plus menu writes to the composer during an edit", async ({page}) => {
		const composer = await openChannelComposer(page);
		const editor = await openInlineEditOfNewMessage(page, composer, 'edit left open');

		await insertTimestampFrom(page, composerPlusButton(page));

		await expect(composer.locator(pill)).toHaveCount(1);
		await expect(editor.locator(pill)).toHaveCount(0);
		await expect(composer).toBeFocused();
	});
});
