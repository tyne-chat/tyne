import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Persona Mentions & Lexical Autocomplete Flow', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can search persona mentions via @, insert mention pill, and observer sees styled mention', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Target Persona Owner)
		const bobEmail = `men_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_men_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob Mentionee',
		});

		const bobPersona = await bobClient.createPersona({
			name: `Bob-Alpha-${timestamp}`,
			pronouns: 'he/him',
			persona_tags: [{prefix: 'ba:'}],
			visibility: 'public',
		});

		// 2. Create Alice (Sender)
		const aliceEmail = `men_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_men_${timestamp}`;
		const aliceClient = new FluxerApiClient(baseURL);
		await aliceClient.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Mentioner',
		});

		// 3. Setup Shared Guild & Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`Mention Guild ${timestamp}`);
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

		// 4. Bob sends an initial message so Bob's persona is cached in the channel
		await bobClient.sendMessage(channelId, `Checking in from ${bobPersona.name}`, bobPersona);

		// 5. Alice logs into the web app
		await loginAs(page, aliceEmail, alicePassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Wait for Bob's initial message
		await expect(page.getByText(`Checking in from ${bobPersona.name}`)).toBeVisible({timeout: 20_000});

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 15_000});

		// 6. Alice types "@" and persona query into the composer
		await composer.click();
		await page.keyboard.type(`@${bobPersona.name.slice(0, 7)}`);

		// 7. Verify Autocomplete popout appears listing the persona candidate
		const personaOption = page
			.locator('[class*="personaName"], [data-flx*="autocomplete-mention"]')
			.filter({hasText: bobPersona.name})
			.first();
		await expect(personaOption).toBeVisible({timeout: 10_000});

		// 8. Select the persona option
		await personaOption.click();

		// Verify mention pill is inserted into the composer
		const mentionPillInComposer = page
			.locator('[data-flx*="composer-mention-pill"], [data-lexical-mention-type="user"]')
			.filter({hasText: `@${bobPersona.name}`})
			.first();
		await expect(mentionPillInComposer).toBeVisible({timeout: 5_000});

		// 9. Add message text and send
		await page.keyboard.type(` hello there! [${timestamp}]`);

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

		// 10. Verify message appears in chat with rendered persona mention
		const messageContainer = page
			.locator('[data-flx*="message-content"]')
			.filter({hasText: `hello there! [${timestamp}]`})
			.first();
		await expect(messageContainer).toBeVisible({timeout: 15_000});

		const renderedMention = messageContainer
			.locator('[data-flx*="mention-renderer"], span[role="button"]')
			.filter({hasText: `@${bobPersona.name}`})
			.first();
		await expect(renderedMention).toBeVisible({timeout: 10_000});

		// 11. Clicking the persona mention opens the PersonaProfilePopout
		await renderedMention.click();
		const profilePopout = page
			.locator('[data-flx*="persona-profile-popout"], [data-flx*="persona-profile-mobile-sheet"]')
			.first();
		await expect(profilePopout).toBeVisible({timeout: 10_000});
		await expect(profilePopout.getByText(bobPersona.name)).toBeVisible({timeout: 5_000});
		await expect(profilePopout.getByText('he/him')).toBeVisible({timeout: 5_000});
	});
});
