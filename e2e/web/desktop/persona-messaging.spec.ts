import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Multi-Account Persona Messaging', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('persona messages render correctly and observer sees persona attribution', async ({browser}) => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		// 1. Create Alice (Observer)
		const aliceEmail = `msg_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_msg_${timestamp}`;
		const aliceAuth = await client.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Observer',
		});

		// 2. Create Bob (Persona User)
		const bobEmail = `msg_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_msg_${timestamp}`;
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
			system_name: 'System Alpha',
			persona_tags: [{prefix: 'a:'}],
		});

		// 3. Create shared Guild and Channel (with single-community fallback)
		const aliceClient = new FluxerApiClient(baseURL, aliceAuth.token);
		let guildId: string;
		let channelId: string;
		try {
			const guild = await aliceClient.createGuild(`Msg Guild ${timestamp}`);
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

		// 4. Bob sends a message with persona via API
		const messageContent = `Hello from persona! [${timestamp}]`;
		await bobClient.sendMessage(channelId, messageContent, bobAlpha);

		// 5. Open Browser Context for Alice (Observer)
		const aliceContext = await browser.newContext();
		const alicePage = await aliceContext.newPage();

		await loginAs(alicePage, aliceEmail, alicePassword);

		// Navigate to shared channel
		await alicePage.goto(`/channels/${guildId}/${channelId}`);

		// Verify message content is visible in the chat log
		await expect(alicePage.getByText(messageContent)).toBeVisible({timeout: 20_000});

		// Verify Bob's persona name appears above or beside the message
		await expect(alicePage.getByText('Bob-Alpha', {exact: true})).toBeVisible({timeout: 10_000});

		await aliceContext.close();
	});
});
