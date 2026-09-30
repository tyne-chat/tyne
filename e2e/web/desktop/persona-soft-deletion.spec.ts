import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Relational Persona Soft-Deletion & Historical Attribution', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('deleting a persona preserves historical message attribution while disabling future proxying', async ({
		page,
		browser,
	}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Persona Owner)
		const bobEmail = `del_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_del_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob Historian',
		});

		const personaName = `Archived-${timestamp}`;
		const bobPersona = await bobClient.createPersona({
			name: personaName,
			pronouns: 'it/its',
			persona_tags: [{prefix: 'arch:'}],
		});

		// 2. Create Alice (Observer)
		const aliceEmail = `del_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_del_${timestamp}`;
		const aliceClient = new FluxerApiClient(baseURL);
		await aliceClient.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Reader',
		});

		// 3. Setup Shared Guild & Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`SoftDel Guild ${timestamp}`);
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

		// 4. Bob posts historical message with persona
		const historicalContent = `Historical message before soft deletion [${timestamp}]`;
		const sentMsg = await bobClient.sendMessage(channelId, historicalContent, bobPersona);
		expect(sentMsg.id).toBeTruthy();

		// 5. Alice logs into web app and verifies initial persona attribution
		await loginAs(page, aliceEmail, alicePassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		await expect(page.getByText(historicalContent)).toBeVisible({timeout: 20_000});
		await expect(page.getByText(personaName)).toBeVisible({timeout: 10_000});

		// 6. Bob soft-deletes the persona
		await bobClient.deletePersona(bobPersona.id);

		// Verify persona is soft-deleted on backend
		const personas = await bobClient.getPersonas();
		expect(personas.some((p) => p.id === bobPersona.id)).toBe(false);

		// 7. Alice reloads the channel: the historical message MUST still display the persona's name!
		await page.reload();
		await expect(page.getByText(historicalContent)).toBeVisible({timeout: 20_000});
		await expect(page.getByText(personaName)).toBeVisible({timeout: 10_000});

		// 8. Bob logs into UI via isolated browser context, attempts to type old tag "arch: New message": should NOT proxy
		const bobContext = await browser.newContext();
		const bobPage = await bobContext.newPage();
		try {
			await loginAs(bobPage, bobEmail, bobPassword);
			await bobPage.goto(`/channels/${guildId}/${channelId}`);

			const composer = bobPage
				.locator(
					'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
				)
				.first();
			await expect(composer).toBeVisible({timeout: 20_000});

			const newContent = `New message with obsolete tag [${timestamp}]`;
			await composer.click();
			await bobPage.keyboard.type(`arch: ${newContent}`);

			// Verify composer pill is not rendered (Bob has no active personas)
			const pill = bobPage.locator('[data-flx="persona.composer-pill"]');
			await expect(pill).toBeHidden();

			// Submit message
			const sendButton = bobPage
				.locator(
					'[data-flx="channel.textarea.textarea-buttons.textarea-button.submit"], button[aria-label*="Send message" i]',
				)
				.first();
			if (await sendButton.isVisible({timeout: 2_000}).catch(() => false)) {
				await sendButton.click();
			} else {
				await bobPage.keyboard.press('Enter');
			}

			// Message is posted with root user attribution (Bob Historian), not the deleted persona
			await expect(bobPage.getByText(`arch: ${newContent}`)).toBeVisible({timeout: 15_000});
			const rootAuthor = bobPage.locator('[data-flx*="message-username"]').getByText('Bob Historian').first();
			await expect(rootAuthor).toBeVisible({timeout: 10_000});
		} finally {
			await bobContext.close();
		}
	});
});
