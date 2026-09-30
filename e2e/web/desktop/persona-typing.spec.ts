import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Real-Time Persona Typing Indicators', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('observer sees persona name in typing indicator when user types with latched persona', async ({
		page,
		browser,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		// 1. Create Alice (Observer)
		const aliceEmail = `typ_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_typ_${timestamp}`;
		const aliceAuth = await client.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Observer',
		});

		// 2. Create Bob (Typing User)
		const bobEmail = `typ_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_typ_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob Typist',
		});

		const bobPersona = await bobClient.createPersona({
			name: `Bob-Alpha-${timestamp}`,
			pronouns: 'he/him',
			persona_tags: [{prefix: 'ba:'}],
		});

		// 3. Setup Shared Guild & Channel
		const aliceClient = new FluxerApiClient(baseURL, aliceAuth.token);
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`Typing Guild ${timestamp}`);
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

		// 4. Bob sends an initial message so persona metadata is cached
		await bobClient.sendMessage(channelId, `Ready for typing test [${timestamp}]`, bobPersona);

		// 5. Open Alice's page (Observer)
		await loginAs(page, aliceEmail, alicePassword);
		await page.goto(`/channels/${guildId}/${channelId}`);
		await expect(page.getByText(`Ready for typing test [${timestamp}]`)).toBeVisible({timeout: 20_000});

		// 6. Open Bob's context and page (Typist)
		const bobContext = await browser.newContext();
		const bobPage = await bobContext.newPage();

		try {
			await loginAs(bobPage, bobEmail, bobPassword);
			await bobPage.goto(`/channels/${guildId}/${channelId}`);

			const bobComposer = bobPage
				.locator(
					'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
				)
				.first();
			await expect(bobComposer).toBeVisible({timeout: 20_000});

			// Latch Bob-Alpha via composer pill
			const pill = bobPage.locator('[data-flx="persona.composer-pill"] button').first();
			await expect(pill).toBeVisible({timeout: 10_000});
			await pill.click();

			const personaOption = bobPage.locator('[class*="personaName"]').filter({hasText: bobPersona.name}).first();
			await expect(personaOption).toBeVisible({timeout: 5_000});
			await personaOption.click();

			// Verify pill indicates latched state
			await expect(pill).toHaveAttribute('aria-label', new RegExp(bobPersona.name, 'i'), {timeout: 5_000});

			// 7. Bob types in composer without sending
			await bobComposer.click();
			await bobPage.keyboard.type('Hello Alice, I am currently typing...');

			// 8. In Alice's browser, verify typing indicator shows "Bob-Alpha-... is typing..."
			const typingIndicator = page
				.locator('[class*="typing"], [data-flx*="typing"]')
				.filter({
					hasText: new RegExp(`${bobPersona.name}.*is typing`, 'i'),
				})
				.first();
			await expect(typingIndicator).toBeVisible({timeout: 15_000});
			await expect(typingIndicator).not.toContainText('Bob Typist');

			// 9. Bob presses Escape to clear or submits message
			await bobComposer.click();
			await bobPage.keyboard.press('Control+A');
			await bobPage.keyboard.press('Backspace');

			// 10. Verify typing indicator clears from Alice's view within 10s
			await expect(typingIndicator).toBeHidden({timeout: 10_000});
		} finally {
			await bobContext.close();
		}
	});
});
