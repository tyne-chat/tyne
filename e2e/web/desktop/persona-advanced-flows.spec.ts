import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Persona Advanced Flows & Quick Commands', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('in-chat quick command \\\\ unlatches active persona without posting to chat', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const bobEmail = `quick_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_quick_${timestamp}`;
		await client.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob QuickCmd',
		});

		await client.createPersona({
			name: 'Bob-Quick',
			pronouns: 'he/they',
			persona_tags: [{prefix: 'q:'}],
		});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Quick Guild ${timestamp}`);
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

		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});

		const pill = page.locator('[data-flx="persona.composer-pill"] button').first();
		await expect(pill).toBeVisible({timeout: 10_000});

		// 1. Latch Bob-Quick via picker sheet
		await pill.click();
		const personaOption = page.locator('[class*="personaName"]').filter({hasText: 'Bob-Quick'}).first();
		await expect(personaOption).toBeVisible({timeout: 5_000});
		await personaOption.click();

		// Verify latched
		await expect(pill).toHaveAttribute('aria-label', /Bob-Quick/i, {timeout: 5_000});

		// 2. Type \\ into composer and submit
		await composer.click();
		await page.keyboard.type('\\\\');

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

		// 3. Verify latch is cleared (pill no longer shows Bob-Quick)
		await expect(pill).not.toHaveAttribute('aria-label', /Bob-Quick/i, {timeout: 5_000});

		// 4. Verify no message containing \\\\ was sent to the channel
		await page.waitForTimeout(1_000);
		expect(await page.locator('[data-flx*="message-content"]').filter({hasText: '\\\\'}).count()).toBe(0);
	});

	test('editing persona message to strip persona reverts author to root user', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const bobEmail = `rev_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_rev_${timestamp}`;
		await client.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob Reverter',
		});

		const persona = await client.createPersona({
			name: 'Bob-Tagged',
			pronouns: 'they/them',
			persona_tags: [{prefix: 't:'}],
		});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Revert Guild ${timestamp}`);
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

		// Send initial message as Bob-Tagged
		const initialText = `Message before reverting [${timestamp}]`;
		const sentMsg = await client.sendMessage(channelId, initialText, persona);
		expect(sentMsg.id).toBeTruthy();

		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Verify message starts as Bob-Tagged
		await expect(page.getByText(initialText)).toBeVisible({timeout: 20_000});
		await expect(page.getByText('Bob-Tagged')).toBeVisible({timeout: 10_000});

		// Edit message with subprofile: null (stripping persona)
		const revertedText = `Message after reverting to root [${timestamp}]`;
		await client.editMessage(channelId, sentMsg.id, revertedText, null);

		// Verify updated message displays root user attribution
		await expect(page.getByText(revertedText)).toBeVisible({timeout: 15_000});
		const messageAuthor = page.locator('[data-flx*="message-username"]').getByText('Bob Reverter').first();
		await expect(messageAuthor).toBeVisible({timeout: 10_000});
	});

	test('temporary tag proxying while latched does not override latched persona', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const bobEmail = `override_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_ovr_${timestamp}`;
		await client.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob Overrider',
		});

		// Create Persona Alpha and Persona Beta
		await client.createPersona({
			name: 'Bob-Alpha',
			pronouns: 'he/him',
			persona_tags: [{prefix: 'a:'}],
		});

		await client.createPersona({
			name: 'Bob-Beta',
			pronouns: 'they/them',
			persona_tags: [{prefix: 'b:'}],
		});

		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Override Guild ${timestamp}`);
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

		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});

		const pill = page.locator('[data-flx="persona.composer-pill"] button').first();
		await expect(pill).toBeVisible({timeout: 20_000});

		// 1. Latch Bob-Alpha
		await pill.click();
		const alphaOption = page.locator('[class*="personaName"]').filter({hasText: 'Bob-Alpha'}).first();
		await expect(alphaOption).toBeVisible({timeout: 5_000});
		await alphaOption.click();

		// Verify pill is latched to Bob-Alpha
		await expect(pill).toHaveAttribute('aria-label', /Bob-Alpha/i, {timeout: 5_000});

		const sendMessage = async (text: string) => {
			await composer.click();
			await page.keyboard.type(text);
			const sendBtn = page
				.locator(
					'[data-flx="channel.textarea.textarea-buttons.textarea-button.submit"], button[aria-label*="Send message" i]',
				)
				.first();
			if (await sendBtn.isVisible({timeout: 1_500}).catch(() => false)) {
				await sendBtn.click();
			} else {
				await page.keyboard.press('Enter');
			}
		};

		// 2. Send message with Beta's tag while Alpha is latched
		const betaMsg = `Single temporary message from Beta [${timestamp}]`;
		await sendMessage(`b: ${betaMsg}`);

		// Verify this single message sent as Bob-Beta
		await expect(page.getByText(betaMsg)).toBeVisible({timeout: 15_000});
		const betaAuthor = page.locator('[data-flx*="message-username"]').getByText('Bob-Beta').first();
		await expect(betaAuthor).toBeVisible({timeout: 10_000});

		// 3. Verify composer pill is STILL latched to Bob-Alpha
		await expect(pill).toHaveAttribute('aria-label', /Bob-Alpha/i, {timeout: 5_000});

		// 4. Send untagged message
		const alphaMsg = `Follow-up untagged message [${timestamp}]`;
		await sendMessage(alphaMsg);

		// Verify follow-up sent as latched Bob-Alpha
		await expect(page.getByText(alphaMsg)).toBeVisible({timeout: 15_000});
		const alphaAuthor = page.locator('[data-flx*="message-username"]').getByText('Bob-Alpha').first();
		await expect(alphaAuthor).toBeVisible({timeout: 10_000});
	});
});
