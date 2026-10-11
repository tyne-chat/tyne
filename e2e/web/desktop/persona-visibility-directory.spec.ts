import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {loginAs} from '../support/auth.js';

test.describe('Persona Visibility & Public Directory Integration', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('enforces 3-tier visibility matrix and mutual context restrictions across API and UI', async ({page}) => {
		const timestamp = Date.now().toString().slice(-6);

		// 1. Create Bob (Owner)
		const bobEmail = `vis_bob_${timestamp}@test.local`;
		const bobPassword = 'TestPassword123!';
		const bobUsername = `bob_vis_${timestamp}`;
		const bobClient = new FluxerApiClient(baseURL);
		const bobAuth = await bobClient.register({
			username: bobUsername,
			email: bobEmail,
			password: bobPassword,
			global_name: 'Bob VisibilityOwner',
		});

		// Bob creates 3 personas with distinct visibility tiers
		const bobPublic = await bobClient.createPersona({
			name: 'Bob-Public',
			pronouns: 'he/him',
			bio: `Public bio [${timestamp}]`,
			visibility: 'public',
			persona_tags: [{prefix: 'pub:'}],
		});

		const bobUnlisted = await bobClient.createPersona({
			name: 'Bob-Unlisted',
			pronouns: 'they/them',
			bio: `Unlisted bio [${timestamp}]`,
			visibility: 'unlisted',
			persona_tags: [{prefix: 'unl:'}],
		});

		const bobPrivate = await bobClient.createPersona({
			name: 'Bob-Private',
			pronouns: 'it/its',
			bio: `Private bio [${timestamp}]`,
			visibility: 'private',
			persona_tags: [{prefix: 'priv:'}],
		});

		// 2. Create Stranger (No shared context with Bob)
		const strangerClient = new FluxerApiClient(baseURL);
		await strangerClient.register({
			username: `stranger_${timestamp}`,
			email: `stranger_${timestamp}@test.local`,
			password: 'TestPassword123!',
			global_name: 'Stranger User',
		});

		// Stranger should be rejected with 403 Forbidden due to lack of mutual context
		await expect(strangerClient.getPublicPersonas(bobAuth.user!.id)).rejects.toThrow(/403/);

		// 3. Create Alice (Mutual Guild Member with Bob)
		const aliceEmail = `vis_alice_${timestamp}@test.local`;
		const alicePassword = 'TestPassword123!';
		const aliceUsername = `alice_vis_${timestamp}`;
		const aliceClient = new FluxerApiClient(baseURL);
		await aliceClient.register({
			username: aliceUsername,
			email: aliceEmail,
			password: alicePassword,
			global_name: 'Alice Member',
		});

		// Setup Shared Guild
		let guildId: string;
		let channelId: string;
		try {
			const guild = await bobClient.createGuild(`Visibility Guild ${timestamp}`);
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

		// 4. Test Public Directory (Alice querying Bob's directory)
		const publicDirectory = await aliceClient.getPublicPersonas(bobAuth.user!.id);
		// Only 'public' personas should appear in directory
		expect(publicDirectory.some((p) => p.id === bobPublic.id)).toBe(true);
		expect(publicDirectory.some((p) => p.id === bobUnlisted.id)).toBe(false);
		expect(publicDirectory.some((p) => p.id === bobPrivate.id)).toBe(false);

		// 5. Test Direct Card Lookup by Persona ID
		// Public: Accessible with bio
		const publicCard = await aliceClient.getPublicPersona(bobAuth.user!.id, bobPublic.id);
		expect(publicCard.name).toBe('Bob-Public');
		expect(publicCard.bio).toBe(`Public bio [${timestamp}]`);

		// Unlisted: Accessible via direct link/lookup (e.g. clicking a chat message)
		const unlistedCard = await aliceClient.getPublicPersona(bobAuth.user!.id, bobUnlisted.id);
		expect(unlistedCard.name).toBe('Bob-Unlisted');
		expect(unlistedCard.bio).toBe(`Unlisted bio [${timestamp}]`);

		// Private: the profile is refused to other users, as private rather than as unknown (403)
		await expect(aliceClient.getPublicPersona(bobAuth.user!.id, bobPrivate.id)).rejects.toThrow(/403/);

		// Owner (Bob) can still access their private persona via self-endpoint
		const ownerPersonas = await bobClient.getPersonas();
		const ownerPrivate = ownerPersonas.find((p) => p.id === bobPrivate.id);
		expect(ownerPrivate).toBeDefined();
		expect(ownerPrivate?.name).toBe('Bob-Private');

		// 6. UI Verification: Bob sends message as Bob-Public, Alice opens Profile Popout
		const messageContent = `Check my public persona [${timestamp}]`;
		await bobClient.sendMessage(channelId, messageContent, bobPublic);

		await loginAs(page, aliceEmail, alicePassword);
		await page.goto(`/channels/${guildId}/${channelId}`);

		await expect(page.getByText(messageContent)).toBeVisible({timeout: 20_000});
		const authorHeader = page.locator('[data-flx*="message-username"]').getByText('Bob-Public');
		await expect(authorHeader).toBeVisible({timeout: 10_000});

		// Alice clicks on the persona name to open the PersonaProfilePopout / MobileSheet
		await authorHeader.click();
		const profileModalOrPopout = page.locator(
			'[data-flx*="persona-profile-popout"], [data-flx*="persona-profile-mobile-sheet"]',
		);
		await expect(profileModalOrPopout.first()).toBeVisible({timeout: 10_000});
		await expect(page.getByText(`Public bio [${timestamp}]`)).toBeVisible({timeout: 10_000});
		await expect(page.getByText('he/him')).toBeVisible({timeout: 10_000});
		await page.keyboard.press('Escape');

		// 7. Bob speaks as Bob-Private: Alice sees the name, and the card says the profile is private
		const privateMessage = `From my private persona [${timestamp}]`;
		await bobClient.sendMessage(channelId, privateMessage, bobPrivate);
		await expect(page.getByText(privateMessage)).toBeVisible({timeout: 20_000});
		const privateHeader = page.locator('[data-flx*="message-username"]').getByText('Bob-Private');
		await expect(privateHeader).toBeVisible({timeout: 10_000});
		await privateHeader.click();
		await expect(page.locator('[data-flx*="private-notice"]').first()).toBeVisible({timeout: 10_000});
		await expect(page.getByText(`Private bio [${timestamp}]`)).toHaveCount(0);
	});
});
