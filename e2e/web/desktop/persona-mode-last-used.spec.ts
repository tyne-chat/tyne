import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs, openPersonasSettings} from '../support/auth.js';

test.describe('Active Persona Mode: Last Used Flow', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('setting mode to Last Used latches persona on tagged message and unlatches on escape', async ({
		page,
		isMobile,
	}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob
		const bobEmail = `bob_last_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_last_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob LastTester',
		});

		await bobClient.createPersona({
			name: 'Bob-Alpha',
			pronouns: 'he/him',
			system_name: 'The Collective',
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
			const guild = await bobClient.createGuild(`LastMode Guild ${timestamp}`);
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

		// 3. Login as Bob
		await loginAs(page, bobEmail, bobPassword);

		// 4. Open User Settings -> Personas tab
		await openPersonasSettings(page);

		// 5. Select "Last Used" mode tab
		const lastUsedTab = page.getByRole('tab', {name: /Last Used/i});
		await expect(lastUsedTab).toBeVisible({timeout: 15_000});
		await lastUsedTab.click();
		await expect(lastUsedTab).toHaveAttribute('aria-selected', 'true');

		// Verify backend settings persistence
		await expect
			.poll(
				async () => {
					const settings = await bobClient.getPersonaSettings();
					return settings.active_persona_mode;
				},
				{timeout: 10_000},
			)
			.toBe('last');

		// 6. Navigate back to text channel
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

		// 7. Send first message with prefix tag "a: Hello from Alpha"
		const firstText = `Hello from Alpha [${timestamp}]`;
		await composer.click();
		await composer.fill(`a: ${firstText}`);
		await submitMessage();

		// Verify message sent with Bob-Alpha persona attribution
		await expect(page.getByText(firstText)).toBeVisible({timeout: 15_000});
		await expect(page.getByText('Bob-Alpha', {exact: true})).toBeVisible({timeout: 10_000});

		// 8. Verify the composer pill now shows Bob-Alpha as latched
		const pill = page.locator('[data-flx="persona.composer-pill"]');
		await expect(pill).toBeVisible({timeout: 10_000});
		const pillButton = pill.locator('button');
		await expect(pillButton).toHaveAttribute('aria-label', /Bob-Alpha/i, {timeout: 10_000});
		await expect(pill.locator('[class*="latchBadge"]')).toBeVisible({timeout: 10_000});

		// 9. Send second message UNTAGGED (should automatically use Bob-Alpha due to Last Used mode)
		const secondText = `Follow-up untagged message [${timestamp}]`;
		await composer.click();
		await composer.fill(secondText);
		await submitMessage();

		await expect(page.getByText(secondText)).toBeVisible({timeout: 15_000});
		// Verify Bob-Alpha is the author of second message
		const bobAlphaHeaders = page.locator('[data-flx*="message-username"]').getByText('Bob-Alpha');
		await expect(bobAlphaHeaders.first()).toBeVisible({timeout: 10_000});

		// 10. Send escaped message with leading backslash to revert to root account
		const thirdText = `Escaped message back to root [${timestamp}]`;
		await composer.click();
		await composer.fill(`\\ ${thirdText}`);
		await submitMessage();

		await expect(page.getByText(thirdText)).toBeVisible({timeout: 15_000});
		// Root author name Bob LastTester should now be present in chat
		await expect(page.locator('[data-flx*="message-username"]').getByText('Bob LastTester')).toBeVisible({
			timeout: 10_000,
		});

		// Verify composer pill is now unlatched (latchBadge hidden, aria-label shows root account)
		await expect(pill.locator('[class*="latchBadge"]')).toBeHidden({timeout: 10_000});
		await expect(pillButton).toHaveAttribute('aria-label', /Sending as @/i, {timeout: 10_000});
	});
});
