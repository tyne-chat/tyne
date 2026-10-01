import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('In-App Persona Reactions UI & Context Menu Flow', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('user can react as specific personas via UI context menu and manage multi-persona reactions', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		// 1. Create Alice (Message Poster)
		const aliceEmail = `react_ui_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_rui_${timestamp}`;
		const aliceAuth = await client.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice PostAuthor',
		});

		// 2. Create Bob (Multi-Persona Reactor)
		const bobEmail = `react_ui_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_rui_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob MultiReactor',
		});

		const bobAlpha = await bobClient.createPersona({
			name: `Bob-Alpha-${timestamp}`,
			pronouns: 'he/him',
			persona_tags: [{prefix: 'ba:'}],
		});

		const bobBeta = await bobClient.createPersona({
			name: `Bob-Beta-${timestamp}`,
			pronouns: 'they/them',
			persona_tags: [{prefix: 'bb:'}],
		});

		// 3. Setup Shared Guild & Channel
		const aliceClient = new FluxerApiClient(baseURL, aliceAuth.token);
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`ReactUI Guild ${timestamp}`);
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

		// 4. Alice sends a message
		const messageText = `Please react to this message! [${timestamp}]`;
		const sentMsg = await aliceClient.sendMessage(channelId, messageText);
		expect(sentMsg.id).toBeTruthy();

		// 5. Bob logs into the web app
		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Wait for the message to load
		const messageLocator = page.locator('[data-flx*="message-content"]').filter({hasText: messageText}).first();
		await expect(messageLocator).toBeVisible({timeout: 20_000});

		// 6. Hover over the message to reveal the message action bar
		await messageLocator.hover();

		const quickReactionBtn = page.locator('button[aria-label*="React with" i]').first();
		await expect(quickReactionBtn).toBeVisible({timeout: 10_000});

		// 7. Right-click the quick reaction button to open the EmojiContextMenu
		await quickReactionBtn.click({button: 'right'});

		// 8. Click "React as..." item in the context menu
		const reactAsMenuItem = page.getByRole('menuitem', {name: /React as\.\.\./i});
		await expect(reactAsMenuItem).toBeVisible({timeout: 5_000});
		await reactAsMenuItem.click();

		// 9. PersonaReactAsModal opens: verify both personas are listed
		const reactAsModal = page.locator('[data-flx="persona.persona-react-as-modal.root"]');
		await expect(reactAsModal).toBeVisible({timeout: 5_000});
		await expect(reactAsModal.getByText(bobAlpha.name)).toBeVisible({timeout: 5_000});
		await expect(reactAsModal.getByText(bobBeta.name)).toBeVisible({timeout: 5_000});

		// 10. Select Bob-Alpha
		const alphaOption = reactAsModal.locator('[class*="personaItem"]').filter({hasText: bobAlpha.name}).first();
		await alphaOption.click();

		// Verify modal closes
		await expect(reactAsModal).toBeHidden({timeout: 5_000});

		// 11. Verify reaction button appears on the message
		const reactionButton = page
			.locator('button[data-flx*="channel.message-reactions.message-reaction-item.reaction-button"]')
			.first();
		await expect(reactionButton).toBeVisible({timeout: 10_000});

		// 12. Hover over the reaction button to verify tooltip attributes Bob-Alpha
		await page.waitForTimeout(500);
		await reactionButton.hover();
		await expect(
			page.locator('[data-flx*="emoji-tooltip-content"]').filter({hasText: bobAlpha.name}).first(),
		).toBeVisible({timeout: 10_000});

		// 13. React as Bob-Beta using second quick reaction button
		await page.mouse.move(0, 0);
		await messageLocator.hover();
		const secondQuickReactionBtn = page.locator('button[aria-label*="React with" i]').nth(1);
		await expect(secondQuickReactionBtn).toBeVisible({timeout: 5_000});
		await secondQuickReactionBtn.click({button: 'right'});

		await expect(reactAsMenuItem).toBeVisible({timeout: 5_000});
		await reactAsMenuItem.click();

		await expect(reactAsModal).toBeVisible({timeout: 5_000});
		const betaOption = reactAsModal.locator('[class*="personaItem"]').filter({hasText: bobBeta.name}).first();
		await betaOption.click();
		await expect(reactAsModal).toBeHidden({timeout: 5_000});

		// 14. Verify second reaction appears
		const allReactionButtons = page.locator(
			'button[data-flx*="channel.message-reactions.message-reaction-item.reaction-button"]',
		);
		await expect(allReactionButtons).toHaveCount(2, {timeout: 10_000});

		// 15. Verify second reaction's tooltip attributes Bob-Beta
		const secondReaction = allReactionButtons.nth(1);
		await secondReaction.hover();
		await expect(
			page.locator('[data-flx*="emoji-tooltip-content"]').filter({hasText: bobBeta.name}).first(),
		).toBeVisible({timeout: 10_000});

		// 16. Re-open React as modal to toggle Bob-Alpha's reaction off
		await page.mouse.move(0, 0);
		await messageLocator.hover();
		await expect(quickReactionBtn).toBeVisible({timeout: 10_000});
		await quickReactionBtn.click({button: 'right'});
		await expect(reactAsMenuItem).toBeVisible({timeout: 5_000});
		await reactAsMenuItem.click();

		await expect(reactAsModal).toBeVisible({timeout: 5_000});
		const alphaOptionToToggle = reactAsModal.locator('[class*="personaItem"]').filter({hasText: bobAlpha.name}).first();
		await alphaOptionToToggle.click();
		await expect(reactAsModal).toBeHidden({timeout: 5_000});

		// Verify Bob-Alpha reaction is removed (only 1 reaction remains: Bob-Beta)
		await expect(allReactionButtons).toHaveCount(1, {timeout: 10_000});
	});
});
