import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Mobile Web Persona Picker', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('mobile viewport displays persona pill and allows persona selection', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);
		const email = `mob_user_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `mob_${timestamp}`;

		await client.register({
			username,
			email,
			password,
			global_name: 'Mobile Tester',
		});

		await client.createPersona({
			name: 'Mobile-Persona',
			pronouns: 'they/them',
			persona_tags: [{prefix: 'm:'}],
		});

		// Create a guild so composer is visible (with single-community fallback)
		let guildId: string;
		let channelId: string;
		try {
			const guild = await client.createGuild(`Mobile Guild ${timestamp}`);
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

		// Log in on mobile viewport
		await loginAs(page, email, password);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Verify chat composer is visible
		const composer = page.locator('[role="textbox"], [contenteditable="true"], textarea').first();
		await expect(composer).toBeVisible({timeout: 20_000});

		// Persona pill button is attached to composer
		const personaPill = page
			.locator('[data-flx="persona.composer-pill"] button, button[aria-label*="persona" i], [class*="pillButton" i]')
			.first();
		await expect(personaPill).toBeVisible({timeout: 10_000});
		await personaPill.click();

		// Mobile sheet / popout opens listing personas
		const personaOption = page.locator('[class*="personaName"]').filter({hasText: 'Mobile-Persona'}).first();
		await expect(personaOption).toBeVisible({timeout: 10_000});
		await personaOption.click();

		// Type and send a message
		const testMsg = `Testing mobile persona [${timestamp}]`;
		await composer.click();
		await page.keyboard.type(testMsg);

		const sendButton = page
			.locator(
				'[data-flx="channel.textarea.textarea-buttons.textarea-button.submit"], button[aria-label*="Send message" i]',
			)
			.first();
		if (await sendButton.isVisible({timeout: 3_000}).catch(() => false)) {
			await sendButton.click();
		} else {
			await page.keyboard.press('Enter');
		}

		// Verify message sent
		await expect(page.getByText(testMsg)).toBeVisible({timeout: 15_000});

		// Tap persona author in message feed to open mobile profile bottom sheet
		const personaAuthor = page.locator('[data-flx*="message-username"]').getByText('Mobile-Persona').first();
		await expect(personaAuthor).toBeVisible({timeout: 10_000});
		await personaAuthor.click();

		// Verify Mobile Profile Sheet appears with persona details
		const mobileSheet = page
			.locator('[data-flx*="persona-profile-mobile-sheet"], [aria-label*="Persona profile: Mobile-Persona"]')
			.first();
		await expect(mobileSheet).toBeVisible({timeout: 10_000});
		await expect(mobileSheet.getByText('they/them')).toBeVisible({timeout: 5_000});
	});
});
