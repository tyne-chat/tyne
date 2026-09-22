import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('In-App Composer Tag Auto-Proxying', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('typing prefix tag auto-matches persona, strips tag, and sends with persona attribution', async ({
		page,
		browser,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		// 1. Create Alice (Observer)
		const aliceEmail = `prx_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_prx_${timestamp}`;
		const aliceAuth = await client.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Observer',
		});

		// 2. Create Bob (Multi-Persona User)
		const bobEmail = `prx_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_prx_${timestamp}`;
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
			system_name: 'The Collective',
			persona_tags: [{prefix: 'a:'}],
		});

		// 3. Setup shared Guild & Channel
		const aliceClient = new FluxerApiClient(baseURL, aliceAuth.token);
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`TagProxy Guild ${timestamp}`);
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

		// 4. Bob logs in via browser
		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});

		// Ensure composer pill is present
		const pill = page.locator('[data-flx="persona.composer-pill"] button').first();
		await expect(pill).toBeVisible({timeout: 10_000});

		// 5. Type with prefix tag: "a: Hello from tag proxying"
		const messageBody = `Hello from tag proxying [${timestamp}]`;
		await composer.click();
		await page.keyboard.type(`a: ${messageBody}`);

		// Verify the composer pill indicates tag-matched state
		await expect(pill).toHaveAttribute('aria-label', /Matched by tag/i, {timeout: 5_000});

		// 6. Submit message (click send button if mobile or press Enter)
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

		// 7. Verify message renders in chat as Bob-Alpha with tag stripped
		await expect(page.getByText(messageBody)).toBeVisible({timeout: 15_000});
		// The raw prefix tag "a:" should not be displayed as part of the message body in the chat log
		expect(
			await page
				.locator('[class*="messageContent"]')
				.filter({hasText: `a: ${messageBody}`})
				.count(),
		).toBe(0);

		// Persona display name should be visible
		await expect(page.getByText('Bob-Alpha')).toBeVisible({timeout: 10_000});

		// 8. Observer (Alice) sees the exact same persona attribution and can open the Persona Profile Popout
		const aliceContext = await browser.newContext();
		const alicePage = await aliceContext.newPage();
		await loginAs(alicePage, aliceEmail, alicePassword);
		await alicePage.goto(`/channels/${guildId}/${channelId}`);

		await expect(alicePage.getByText(messageBody)).toBeVisible({timeout: 20_000});
		const authorHeader = alicePage.getByText('Bob-Alpha').first();
		await expect(authorHeader).toBeVisible({timeout: 10_000});

		// Click author name to open persona profile popout
		await authorHeader.click();

		// Verify persona profile popout shows pronouns and system name
		await expect(alicePage.getByText('he/him')).toBeVisible({timeout: 10_000});
		await expect(alicePage.getByText('The Collective')).toBeVisible({timeout: 10_000});

		await aliceContext.close();
	});
});
