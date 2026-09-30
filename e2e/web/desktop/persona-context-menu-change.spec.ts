import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('In-Chat Context Menu "Change Persona" Flow', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can re-attribute already sent messages via message context menu', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Message Author with two personas)
		const bobEmail = `chg_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_chg_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob MultiPersona',
		});

		const bobAlpha = await bobClient.createPersona({
			name: `Alpha-${timestamp}`,
			pronouns: 'he/him',
			persona_tags: [{prefix: 'a:'}],
		});

		const bobBeta = await bobClient.createPersona({
			name: `Beta-${timestamp}`,
			pronouns: 'they/them',
			persona_tags: [{prefix: 'b:'}],
		});

		// 2. Setup Guild & Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await bobClient.createGuild(`Change Guild ${timestamp}`);
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

		// 3. Bob sends initial message as Alpha
		const messageContent = `Original message to change persona [${timestamp}]`;
		const sentMsg = await bobClient.sendMessage(channelId, messageContent, bobAlpha);
		expect(sentMsg.id).toBeTruthy();

		// 4. Bob logs in via web app
		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Wait for the message and verify Alpha attribution
		const messageLocator = page.locator('[data-flx*="message-content"]').filter({hasText: messageContent}).first();
		await expect(messageLocator).toBeVisible({timeout: 20_000});
		await expect(page.getByText(bobAlpha.name)).toBeVisible({timeout: 10_000});

		// 5. Right-click the message to open MessageContextMenu
		await messageLocator.click({button: 'right'});

		// 6. Select "Change persona" menu item
		const changePersonaItem = page.getByRole('menuitem', {name: /Change persona/i});
		await expect(changePersonaItem).toBeVisible({timeout: 5_000});
		await changePersonaItem.click();

		// 7. PersonaPickerSheet popout opens attached to the message: select Beta
		const betaOption = page.locator('[class*="personaName"]').filter({hasText: bobBeta.name}).first();
		await expect(betaOption).toBeVisible({timeout: 5_000});
		await betaOption.click();

		// 8. Verify message author updates to Beta in chat
		await expect(page.locator('[data-flx*="message-username"]').getByText(bobBeta.name)).toBeVisible({timeout: 10_000});

		// 9. Right-click message again to revert back to Root Account
		await messageLocator.click({button: 'right'});
		await expect(changePersonaItem).toBeVisible({timeout: 5_000});
		await changePersonaItem.click();

		// In picker sheet, select Root Account
		const rootAccountOption = page
			.locator('[class*="personaName"], [class*="accountRow"], [data-flx*="root-account"]')
			.filter({hasText: /Bob MultiPersona|Root Account|bob_chg/i})
			.first();
		await expect(rootAccountOption).toBeVisible({timeout: 5_000});
		await rootAccountOption.click();

		// 10. Verify message author reverts to root user (Bob MultiPersona)
		await expect(page.locator('[data-flx*="message-username"]').getByText('Bob MultiPersona')).toBeVisible({
			timeout: 10_000,
		});
	});
});
