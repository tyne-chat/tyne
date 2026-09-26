import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Persona Message Lifecycle & Real-Time Actions', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('editing persona message preserves attribution and displays edited badge, delete removes message', async ({
		page,
	}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		// 1. Create Alice (Observer)
		const aliceEmail = `act_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_act_${timestamp}`;
		const aliceAuth = await client.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Observer',
		});

		// 2. Create Bob (Persona User)
		const bobEmail = `act_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_act_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob MultiPersona',
		});

		const bobAlpha = await bobClient.createPersona({
			name: 'Bob-Alpha',
			pronouns: 'he/him',
			persona_tags: [{prefix: 'a:'}],
		});

		// 3. Setup Guild & Channel
		const aliceClient = new FluxerApiClient(baseURL, aliceAuth.token);
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`Action Guild ${timestamp}`);
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

		// 4. Bob sends initial message with persona
		const initialText = `Initial persona message [${timestamp}]`;
		const sentMsg = await bobClient.sendMessage(channelId, initialText, bobAlpha);
		expect(sentMsg.id).toBeTruthy();

		// 5. Alice logs into the channel
		await loginAs(page, aliceEmail, alicePassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		// Verify initial message and persona attribution
		await expect(page.getByText(initialText)).toBeVisible({timeout: 20_000});
		await expect(page.getByText('Bob-Alpha')).toBeVisible({timeout: 10_000});

		// 6. Bob edits the message
		const updatedText = `Updated persona message text [${timestamp}]`;
		await bobClient.editMessage(channelId, sentMsg.id, updatedText);

		// 7. Alice's UI should update live via WebSocket
		await expect(page.getByText(updatedText)).toBeVisible({timeout: 15_000});
		// Old text should no longer be present
		expect(await page.getByText(initialText).count()).toBe(0);
		// Persona author attribution MUST still be Bob-Alpha
		await expect(page.getByText('Bob-Alpha')).toBeVisible({timeout: 10_000});
		// Edited indicator should appear
		await expect(page.getByText(/edited/i)).toBeVisible({timeout: 10_000});

		// 8. Bob deletes the message
		await bobClient.deleteMessage(channelId, sentMsg.id);

		// 9. Alice's UI should see the message disappear
		await expect(page.getByText(updatedText)).toBeHidden({timeout: 15_000});
	});
});
