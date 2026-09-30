import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Persona Reply Previews & Referenced Message Hydration', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('replying to a persona message hydrates persona name in reply bar and renders persona attribution on reply reference', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Original Persona Author)
		const bobEmail = `rep_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_rep_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob OriginalAuthor',
		});

		const bobPersona = await bobClient.createPersona({
			name: `Bob-Alpha-${timestamp}`,
			pronouns: 'he/they',
			persona_tags: [{prefix: 'ba:'}],
		});

		// 2. Create Alice (Replier)
		const aliceEmail = `rep_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_rep_${timestamp}`;
		const aliceClient = new FluxerApiClient(baseURL);
		await aliceClient.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Replier',
		});

		// 3. Setup Shared Guild & Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`Reply Guild ${timestamp}`);
			guildId = guild.id;
			const channels = await aliceClient.getGuildChannels(guildId);
			const channel = channels.find((c) => c.type === 0) || channels[0];
			channelId = channel.id;
			const invite = await aliceClient.createInvite(channelId);
			await bobClient.acceptInvite(invite.code);
		} catch (err: any) {
			if (err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
				const guilds = await aliceClient.getMyGuilds();
				guildId = guilds[0].id;
				const channels = await aliceClient.getGuildChannels(guildId);
				const channel = channels.find((c) => c.type === 0) || channels[0];
				channelId = channel.id;
			} else {
				throw err;
			}
		}

		// 4. Bob sends initial message as Bob-Alpha
		const originalMessageText = `Original message to be replied to [${timestamp}]`;
		const bobMsg = await bobClient.sendMessage(channelId, originalMessageText, bobPersona);
		expect(bobMsg.id).toBeTruthy();

		// 5. Alice logs into the web client and navigates to the channel
		await loginAs(page, aliceEmail, alicePassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Wait for Bob's original message to be visible
		const messageLocator = page.locator('[data-flx*="message-content"]').filter({hasText: originalMessageText}).first();
		await expect(messageLocator).toBeVisible({timeout: 20_000});

		// Verify Bob's persona name is displayed
		await expect(page.getByText(bobPersona.name)).toBeVisible({timeout: 10_000});

		// 6. Alice hovers over Bob's message to reveal the message action bar
		await messageLocator.hover();

		const replyButton = page
			.locator(
				'[data-flx="channel.message-action-bar.message-action-bar-core.message-action-bar-button.reply"], button[aria-label="Reply"]',
			)
			.first();
		await expect(replyButton).toBeVisible({timeout: 10_000});
		await replyButton.click();

		// 7. Verify ChannelReplyBar appears above composer displaying "Replying to Bob-Alpha-..."
		const replyBar = page.locator('[data-flx="channel.reply-bar.top-border"]');
		await expect(replyBar).toBeVisible({timeout: 5_000});
		const replyAuthorName = page.locator('[data-flx="channel.reply-bar.author-name"]');
		await expect(replyAuthorName).toHaveText(bobPersona.name, {timeout: 5_000});

		// 8. Alice enters reply content and submits
		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 10_000});
		await composer.click();

		const replyContent = `Alice replying back! [${timestamp}]`;
		await page.keyboard.type(replyContent);

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

		// 9. Verify Alice's reply message appears in chat with ReplyPreview attached
		const replyMsgLocator = page.locator('[data-flx*="message-content"]').filter({hasText: replyContent}).first();
		await expect(replyMsgLocator).toBeVisible({timeout: 15_000});

		// In the ReplyPreview, verify the referenced author is Bob-Alpha
		const replyPreview = page
			.locator('[data-flx*="channel.reply-preview.replied-message"]')
			.filter({hasText: bobPersona.name})
			.first();
		await expect(replyPreview).toBeVisible({timeout: 10_000});
		await expect(replyPreview.getByText(bobPersona.name)).toBeVisible({timeout: 5_000});

		// 10. Clicking the reply reference jumps to Bob's original message
		const replyPreviewButton = replyPreview.locator('button').first();
		await replyPreviewButton.click();
		await expect(messageLocator).toBeVisible();
	});
});
