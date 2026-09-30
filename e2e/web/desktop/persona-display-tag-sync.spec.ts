import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openPersonasSettings} from '../support/auth.js';

test.describe('Account Display Tag Settings Live Sync', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can configure display tag text with unsaved changes banner and verify tag appears on messages', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const email = `tag_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `tag_${timestamp}`;
		await client.register({
			username,
			email,
			password,
			global_name: 'Tag Tester',
		});

		await client.createPersona({
			name: `Bob-Alpha-${timestamp}`,
			pronouns: 'he/him',
			persona_tags: [{prefix: 'ba:'}],
		});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Tag Guild ${timestamp}`);
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

		// 1. Log in and open User Settings -> Personas tab
		await loginAs(page, email, password);
		await openPersonasSettings(page);

		// 2. Locate Display Tag text input
		const tagInput = page.locator('input[placeholder*="Wonderland" i]').first();
		await expect(tagInput).toBeVisible({timeout: 15_000});

		const newTagText = `Col-${timestamp}`;
		await tagInput.fill(newTagText);

		// 3. Verify Unsaved Changes banner appears
		await expect(page.getByText(/You have unsaved changes/i)).toBeVisible({timeout: 5_000});

		// 4. Click Save changes
		const saveChangesBtn = page.getByRole('button', {name: /Save changes/i});
		await expect(saveChangesBtn).toBeVisible({timeout: 5_000});
		await saveChangesBtn.click();

		// 5. Verify Unsaved Changes banner clears
		await expect(page.getByText(/You have unsaved changes/i)).toBeHidden({timeout: 10_000});

		// 6. Navigate to channel and send message with persona prefix
		await page.goto(`/channels/${guildId}/${channelId}`);

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});

		const messageText = `Testing display tag banner sync [${timestamp}]`;
		await composer.click();
		await page.keyboard.type(`ba: ${messageText}`);

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

		// 7. Verify message renders with the configured display tag
		const messageLocator = page.locator('[data-flx*="message-content"]').filter({hasText: messageText}).first();
		await expect(messageLocator).toBeVisible({timeout: 20_000});

		const displayTagBadge = page
			.locator('[data-flx="persona.tag"], [class*="tag"]')
			.filter({hasText: newTagText})
			.first();
		await expect(displayTagBadge).toBeVisible({timeout: 10_000});
	});
});
