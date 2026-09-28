import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Real-Time Persona Reaction Updates on Rename', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('observer UI updates persona reaction name live when persona is renamed without page refresh', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		// 1. Create Alice (Observer)
		const aliceEmail = `react_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_react_${timestamp}`;
		const aliceAuth = await client.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Observer',
		});

		// 2. Create Bob (Persona User)
		const bobEmail = `react_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_react_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob MultiPersona',
		});

		// 3. Bob creates persona "Astra Starlight"
		const bobPersona = await bobClient.createPersona({
			name: 'Astra Starlight',
			pronouns: 'they/them',
			persona_tags: [{prefix: 'as:'}],
		});

		// 4. Setup Guild and Channel
		const aliceClient = new FluxerApiClient(baseURL, aliceAuth.token);
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`Reaction Guild ${timestamp}`);
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

		// 5. Alice posts a message
		const messageContent = `Testing reactions with persona! [${timestamp}]`;
		const sentMsg = await aliceClient.sendMessage(channelId, messageContent);
		expect(sentMsg.id).toBeTruthy();

		// 6. Bob reacts to the message with ❤️ as persona "Astra Starlight"
		await bobClient.addReaction(channelId, sentMsg.id, '❤️', bobPersona.id);

		// 7. Alice logs into the web app and navigates to the channel
		await loginAs(page, aliceEmail, alicePassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Wait for the message and reaction button to be visible
		await expect(page.getByText(messageContent)).toBeVisible({timeout: 20_000});
		const reactionButton = page.locator('[data-flx*="channel.message-reactions.message-reaction-item"]').first();
		await expect(reactionButton).toBeVisible({timeout: 10_000});

		// 8. Hover over the reaction button to display the tooltip
		await reactionButton.hover();

		// Tooltip should display the original persona name: "Astra Starlight"
		const tooltipTextContainer = page.locator(
			'[data-flx="ui.emoji-tooltip-content.emoji-tooltip-content.text-container--2"]',
		);
		await expect(tooltipTextContainer).toContainText('Astra Starlight', {timeout: 10_000});

		// Click tooltip to open MessageReactionsModal
		const tooltipClickArea = page.locator('[data-flx="messaging.reaction-tooltip.emoji-tooltip-content.click"]');
		if (await tooltipClickArea.isVisible({timeout: 2_000}).catch(() => false)) {
			await tooltipClickArea.click();
			const reactorName = page
				.locator('[data-flx="app.message-reactions-content.reactor-list-item.reactor-name"]')
				.first();
			await expect(reactorName).toHaveText('Astra Starlight', {timeout: 10_000});

			// Close modal by pressing Escape
			await page.keyboard.press('Escape');
		}

		// 9. Bob renames the persona from "Astra Starlight" to "Astra"
		// This triggers the GUILD_PERSONAS_DIRTY gateway event to Alice!
		await bobClient.updatePersona(bobPersona.id, {
			name: 'Astra',
		});

		// 10. WITHOUT refreshing Alice's page, verify the reaction tooltip reflects the new name!
		// Move mouse away and hover back to re-trigger tooltip
		await page.mouse.move(0, 0);
		await page.waitForTimeout(500);
		await reactionButton.hover();

		// The tooltip MUST now show "Astra" and NOT "Astra Starlight"
		await expect(tooltipTextContainer).toContainText('Astra', {timeout: 15_000});
		await expect(tooltipTextContainer).not.toContainText('Starlight');

		// Also verify in the MessageReactionsModal live
		if (await tooltipClickArea.isVisible({timeout: 2_000}).catch(() => false)) {
			await tooltipClickArea.click();
			const reactorName = page
				.locator('[data-flx="app.message-reactions-content.reactor-list-item.reactor-name"]')
				.first();
			await expect(reactorName).toHaveText('Astra', {timeout: 10_000});
		}
	});

	test('persona owner UI updates reaction persona name live on edit without page refresh', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Persona Owner & Reactor)
		const bobEmail = `owner_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_owner_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob Owner',
		});

		// 2. Bob creates persona "Zephyr Windwalker"
		const bobPersona = await bobClient.createPersona({
			name: 'Zephyr Windwalker',
			pronouns: 'they/them',
		});

		// 3. Setup Guild and Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await bobClient.createGuild(`Owner Guild ${timestamp}`);
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

		// 4. Bob posts a message and reacts as Zephyr Windwalker
		const messageContent = `Owner reaction test! [${timestamp}]`;
		const sentMsg = await bobClient.sendMessage(channelId, messageContent);
		await bobClient.addReaction(channelId, sentMsg.id, '❤️', bobPersona.id);

		// 5. Bob logs in via web UI
		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Wait for message & reaction
		await expect(page.getByText(messageContent)).toBeVisible({timeout: 20_000});
		const reactionButton = page.locator('[data-flx*="channel.message-reactions.message-reaction-item"]').first();
		await expect(reactionButton).toBeVisible({timeout: 10_000});

		// 6. Hover over reaction
		await reactionButton.hover();
		const tooltipTextContainer = page.locator(
			'[data-flx="ui.emoji-tooltip-content.emoji-tooltip-content.text-container--2"]',
		);
		await expect(tooltipTextContainer).toContainText('Zephyr Windwalker', {timeout: 10_000});

		// 7. Bob updates persona via API (simulating USER_PERSONA_UPDATE gateway dispatch)
		await bobClient.updatePersona(bobPersona.id, {
			name: 'Zephyr',
		});

		// 8. Re-hover and verify instant update without page refresh
		await page.mouse.move(0, 0);
		await page.waitForTimeout(500);
		await reactionButton.hover();

		await expect(tooltipTextContainer).toContainText('Zephyr', {timeout: 15_000});
		await expect(tooltipTextContainer).not.toContainText('Windwalker');
	});
});
