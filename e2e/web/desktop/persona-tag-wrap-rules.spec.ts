import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Persona Wrap & Suffix Tag Proxying with Display Tag', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('bracket wrapping tags and suffix-only tags auto-proxy and display custom tag badge', async ({
		page,
		browser,
		isMobile,
	}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Persona User)
		const bobEmail = `wrap_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_wrap_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob WrapTester',
		});

		// Persona 1: Bracket wrap tags [text]
		await bobClient.createPersona({
			name: 'Bob-Bracket',
			pronouns: 'they/them',
			system_name: 'BracketSystem',
			persona_tags: [{prefix: '[', suffix: ']'}],
		});

		// Set user-level display tag text
		await bobClient.updatePersonaSettings({display_tag_text: 'BracketTag'});

		// Persona 2: Suffix-only tag text -s
		await bobClient.createPersona({
			name: 'Bob-Suffix',
			pronouns: 'she/her',
			persona_tags: [{suffix: '-s'}],
		});

		// 2. Create Alice (Observer)
		const aliceEmail = `wrap_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_wrap_${timestamp}`;
		const aliceClient = new FluxerApiClient(baseURL);
		await aliceClient.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Observer',
		});

		// 3. Setup Guild & Channel
		let guildId: string;
		let channelId: string;
		try {
			const guild = await bobClient.createGuild(`Wrap Guild ${timestamp}`);
			guildId = guild.id;
			const channels = await bobClient.getGuildChannels(guildId);
			const channel = channels.find((c) => c.type === 0) || channels[0];
			channelId = channel.id;
			const invite = await bobClient.createInvite(channelId);
			await aliceClient.acceptInvite(invite.code);
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

		// 4. Bob logs in and types in the chat composer
		await loginAs(page, bobEmail, bobPassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		const composer = page
			.locator(
				'flx-channel-textarea-composer [contenteditable="true"], [data-flx*="flx-channel-textarea-composer"] [contenteditable="true"]',
			)
			.first();
		await expect(composer).toBeVisible({timeout: 20_000});

		const submitMessage = async () => {
			if (isMobile) {
				const sendBtn = page
					.locator(
						'[data-flx="channel.textarea.textarea-buttons.textarea-button.submit"], button[aria-label="Send message"]',
					)
					.first();
				if (await sendBtn.isVisible({timeout: 1_000}).catch(() => false)) {
					await sendBtn.click();
					return;
				}
			}
			await composer.press('Enter');
		};

		// Test 1: Send bracket wrapped message: [Inside brackets message]
		const bracketBody = `Inside brackets message [${timestamp}]`;
		await composer.click();
		await composer.fill(`[${bracketBody}]`);
		await submitMessage();

		// Verify Bob's view: message body has brackets stripped and persona is Bob-Bracket
		await expect(page.getByText(bracketBody)).toBeVisible({timeout: 15_000});
		await expect(page.locator('[data-flx*="message-username"]').getByText('Bob-Bracket')).toBeVisible({
			timeout: 10_000,
		});
		// Display tag text should appear next to the persona
		await expect(page.locator('[data-flx="persona.tag"]').filter({hasText: 'BracketTag'}).first()).toBeVisible({
			timeout: 10_000,
		});

		// Test 2: Send suffix-only message: Suffix message -s
		const suffixBody = `Suffix message [${timestamp}]`;
		await composer.click();
		await composer.fill(`${suffixBody} -s`);
		await submitMessage();

		// Verify Bob's view: -s is stripped and persona is Bob-Suffix
		await expect(page.getByText(suffixBody)).toBeVisible({timeout: 15_000});
		await expect(page.locator('[data-flx*="message-username"]').getByText('Bob-Suffix')).toBeVisible({timeout: 10_000});

		// 5. Observer (Alice) verifies both messages and badges in real-time
		const aliceContext = await browser.newContext();
		const alicePage = await aliceContext.newPage();
		await loginAs(alicePage, aliceEmail, alicePassword);
		await alicePage.goto(`/channels/${guildId}/${channelId}`);

		await expect(alicePage.getByText(bracketBody)).toBeVisible({timeout: 20_000});
		await expect(alicePage.locator('[data-flx*="message-username"]').getByText('Bob-Bracket')).toBeVisible({
			timeout: 10_000,
		});
		await expect(alicePage.locator('[data-flx="persona.tag"]').filter({hasText: 'BracketTag'}).first()).toBeVisible({
			timeout: 10_000,
		});

		await expect(alicePage.getByText(suffixBody)).toBeVisible({timeout: 15_000});
		await expect(alicePage.locator('[data-flx*="message-username"]').getByText('Bob-Suffix')).toBeVisible({
			timeout: 10_000,
		});

		await aliceContext.close();
	});
});
