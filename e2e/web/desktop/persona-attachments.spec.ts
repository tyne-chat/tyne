import {resolve} from 'node:path';
import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Image & Attachment Uploads with Persona Attribution', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can attach an image file and send it with persona proxy attribution', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Persona User)
		const bobEmail = `att_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_att_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob Attacher',
		});

		const bobPersona = await bobClient.createPersona({
			name: `Bob-Alpha-${timestamp}`,
			pronouns: 'he/him',
			persona_tags: [{prefix: 'ba:'}],
		});

		// 2. Setup Guild & Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await bobClient.createGuild(`Attach Guild ${timestamp}`);
			guildId = guild.id;
			const channels = await bobClient.getGuildChannels(guildId);
			const channel = channels.find((c) => c.type === 0) || channels[0];
			channelId = channel.id;
		} catch (err: any) {
			if (err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
				const guilds = await bobClient.getMyGuilds();
				guildId = guilds[0].id;
				const channels = await bobClient.getGuildChannels(guildId);
				const channel = channels.find((c) => c.type === 0) || channels[0];
				channelId = channel.id;
			} else {
				throw err;
			}
		}

		// 3. Bob logs into web app
		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});

		// 4. Click plus button to trigger file upload
		const plusButton = page.locator('flx-channel-textarea-upload-column button').first();
		await expect(plusButton).toBeVisible({timeout: 10_000});

		const fileChooserPromise = page.waitForEvent('filechooser');
		await plusButton.click();

		const uploadMenuItem = page.getByRole('menuitem', {name: /Upload file/i});
		await expect(uploadMenuItem).toBeVisible({timeout: 5_000});
		await uploadMenuItem.click();

		const fileChooser = await fileChooserPromise;
		const fixturePath = resolve(process.cwd(), 'fixtures/avatar.png');
		await fileChooser.setFiles(fixturePath);

		// 5. Verify attachment preview card appears in composer area
		const attachmentArea = page.locator('[data-flx*="channel-attachment-area"], [class*="attachment"]').first();
		await expect(attachmentArea).toBeVisible({timeout: 10_000});

		// 6. Type persona prefix tag and message text
		const messageCaption = `Image attachment sent via persona! [${timestamp}]`;
		await composer.click();
		await page.keyboard.type(`ba: ${messageCaption}`);

		// Verify composer pill indicates tag-matched state
		const pill = page.locator('[data-flx="persona.composer-pill"] button').first();
		await expect(pill).toHaveAttribute('aria-label', /Matched by tag/i, {timeout: 5_000});

		// 7. Submit message
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

		// 8. Verify message appears in chat with attachment and persona attribution
		const messageLocator = page.locator('[data-flx*="message-content"]').filter({hasText: messageCaption}).first();
		await expect(messageLocator).toBeVisible({timeout: 20_000});

		// Verify persona author name
		await expect(page.locator('[data-flx*="message-username"]').getByText(bobPersona.name)).toBeVisible({
			timeout: 10_000,
		});

		// Verify attached image rendered
		const attachedImage = page
			.locator('img[src*="attachment"], img[alt*="avatar.png"], [data-flx*="attachment"]')
			.first();
		await expect(attachedImage).toBeVisible({timeout: 15_000});
	});
});
