import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Composer Persona Latching and Search', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can search personas in sheet, latch a persona, send untagged, and unlatch to root', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Multi-Persona User with 2 personas)
		const bobEmail = `latch_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_latch_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob MultiPersona',
		});

		await bobClient.createPersona({
			name: 'Bob-Alpha',
			pronouns: 'he/him',
			persona_tags: [{prefix: 'a:'}],
		});

		await bobClient.createPersona({
			name: 'Bob-Beta',
			pronouns: 'they/them',
			persona_tags: [{prefix: 'b:'}],
		});

		// 2. Setup Guild & Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await bobClient.createGuild(`Latch Guild ${timestamp}`);
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

		const pill = page.locator('[data-flx="persona.composer-pill"] button').first();
		await expect(pill).toBeVisible({timeout: 10_000});

		// 4. Click pill to open PersonaPickerSheet
		await pill.click();

		// Verify search input is present in sheet
		const searchInput = page.locator('input[placeholder*="Search personas" i], input[type="text"]').first();
		await expect(searchInput).toBeVisible({timeout: 5_000});

		// Test filter: type "Beta"
		await searchInput.fill('Beta');
		const betaOption = page.locator('[class*="personaName"]').filter({hasText: 'Bob-Beta'}).first();
		await expect(betaOption).toBeVisible({timeout: 5_000});
		// Bob-Alpha should be filtered out
		expect(await page.locator('[class*="personaName"]').filter({hasText: 'Bob-Alpha'}).count()).toBe(0);

		// 5. Select Bob-Beta to latch
		await betaOption.click();

		// Verify pill indicates latched state (has locked class or badge)
		await expect(pill).toHaveAttribute('aria-label', /Bob-Beta/i, {timeout: 5_000});

		// 6. Send an untagged message while latched
		const latchedMsg = `Sending while latched as Beta [${timestamp}]`;
		await composer.click();
		await page.keyboard.type(latchedMsg);

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

		// Verify message appears in chat as Bob-Beta
		await expect(page.getByText(latchedMsg)).toBeVisible({timeout: 15_000});
		await expect(page.getByText('Bob-Beta')).toBeVisible({timeout: 10_000});

		// 7. Click pill again to unlatch back to root account
		await pill.click();

		// The sheet offers the root account option ("Root Account (Default)")
		const rootAccountOption = page
			.locator('[data-flx="persona.picker-sheet"]')
			.getByText(/Root Account/i)
			.first();
		await expect(rootAccountOption).toBeVisible({timeout: 5_000});
		await rootAccountOption.click();

		// Verify pill is unlatched
		await expect(pill).not.toHaveAttribute('aria-label', /Bob-Beta/i, {timeout: 5_000});

		// 8. Send message as root account
		const rootMsg = `Sending as root account [${timestamp}]`;
		await composer.click();
		await page.keyboard.type(rootMsg);

		if (await sendButton.isVisible({timeout: 2_000}).catch(() => false)) {
			await sendButton.click();
		} else {
			await page.keyboard.press('Enter');
		}

		await expect(page.getByText(rootMsg)).toBeVisible({timeout: 15_000});
	});
});
