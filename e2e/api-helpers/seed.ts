import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FluxerApiClient} from './client.js';
import type {SeedDataResult, TestAccountInfo} from './types.js';

const API_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:9188';

export async function seedTestData(baseUrl: string = API_BASE_URL): Promise<SeedDataResult> {
	console.log(`[SEED] Connecting to Fluxer instance at: ${baseUrl}`);

	const timestamp = Date.now().toString().slice(-6);

	// 1. Register Alice (Normal User / Observer)
	console.log('[SEED] Creating user Alice...');
	const aliceClient = new FluxerApiClient(baseUrl);
	const aliceEmail = `e2e_alice_${timestamp}@test.local`;
	const alicePassword = 'TestPassword123!';
	const aliceUsername = `alice_${timestamp}`;
	const aliceAuth = await aliceClient.register({
		username: aliceUsername,
		email: aliceEmail,
		password: alicePassword,
		global_name: 'Alice Observer',
	});
	const aliceMe = await aliceClient.getMe();
	const alice: TestAccountInfo = {
		username: aliceUsername,
		email: aliceEmail,
		password: alicePassword,
		token: aliceAuth.token,
		userId: aliceMe.id,
		personas: [],
	};

	// 2. Register Bob (Persona User)
	console.log('[SEED] Creating user Bob...');
	const bobClient = new FluxerApiClient(baseUrl);
	const bobEmail = `e2e_bob_${timestamp}@test.local`;
	const bobPassword = 'TestPassword123!';
	const bobUsername = `bob_${timestamp}`;
	const bobAuth = await bobClient.register({
		username: bobUsername,
		email: bobEmail,
		password: bobPassword,
		global_name: 'Bob MultiPersona',
	});
	const bobMe = await bobClient.getMe();

	// Create Bob's personas
	console.log("[SEED] Creating Bob's personas...");
	const bobAlpha = await bobClient.createPersona({
		name: 'Bob-Alpha',
		pronouns: 'he/him',
		system_name: 'The Collective',
		persona_tags: [{prefix: 'a:'}],
		bio: 'Primary front persona for testing',
	});

	const bobBeta = await bobClient.createPersona({
		name: 'Bob-Beta',
		pronouns: 'they/them',
		system_name: 'The Collective',
		persona_tags: [{prefix: 'b:'}],
		bio: 'Secondary front persona for testing',
	});

	const bob: TestAccountInfo = {
		username: bobUsername,
		email: bobEmail,
		password: bobPassword,
		token: bobAuth.token,
		userId: bobMe.id,
		personas: [bobAlpha, bobBeta],
	};

	// 3. Register Carol (Second Persona User)
	console.log('[SEED] Creating user Carol...');
	const carolClient = new FluxerApiClient(baseUrl);
	const carolEmail = `e2e_carol_${timestamp}@test.local`;
	const carolPassword = 'TestPassword123!';
	const carolUsername = `carol_${timestamp}`;
	const carolAuth = await carolClient.register({
		username: carolUsername,
		email: carolEmail,
		password: carolPassword,
		global_name: 'Carol System',
	});
	const carolMe = await carolClient.getMe();

	const carolMain = await carolClient.createPersona({
		name: 'Carol-Main',
		pronouns: 'she/her',
		persona_tags: [{prefix: 'c:'}],
		bio: 'Carol primary persona',
	});

	const carol: TestAccountInfo = {
		username: carolUsername,
		email: carolEmail,
		password: carolPassword,
		token: carolAuth.token,
		userId: carolMe.id,
		personas: [carolMain],
	};

	// 4. Create shared Guild and Channel
	console.log('[SEED] Resolving shared test guild and channel...');
	let guildId: string;
	let channelId: string;

	try {
		const guild = await aliceClient.createGuild(`E2E Guild ${timestamp}`);
		guildId = guild.id;
		const channels = await aliceClient.getGuildChannels(guild.id);
		const generalChannel = channels.find((c) => c.type === 0) || channels[0];
		if (!generalChannel) {
			throw new Error('No default text channel found in newly created guild');
		}
		channelId = generalChannel.id;

		const invite = await aliceClient.createInvite(generalChannel.id);
		console.log(`[SEED] Guild invite created: ${invite.code}`);

		// Bob and Carol join the guild
		await bobClient.acceptInvite(invite.code);
		await carolClient.acceptInvite(invite.code);
	} catch (err: any) {
		if (err.message?.includes('SINGLE_COMMUNITY_CANNOT_CREATE_GUILDS')) {
			console.log('[SEED] Single community mode detected; resolving default community guild...');
			const guilds = await aliceClient.getMyGuilds();
			if (!guilds || guilds.length === 0) {
				throw new Error('In single community mode but Alice has no default guild');
			}
			guildId = guilds[0].id;
			const channels = await aliceClient.getGuildChannels(guildId);
			const generalChannel = channels.find((c) => c.type === 0) || channels[0];
			if (!generalChannel) {
				throw new Error('No text channel in single community guild');
			}
			channelId = generalChannel.id;
		} else {
			throw err;
		}
	}

	const result: SeedDataResult = {
		apiUrl: baseUrl,
		alice,
		bob,
		carol,
		guildId,
		channelId,
	};

	// Persist to .env.test for tests to pick up
	const envContent = [
		`# Generated test seed configuration - ${new Date().toISOString()}`,
		`E2E_BASE_URL=${baseUrl}`,
		`E2E_GUILD_ID=${guildId}`,
		`E2E_CHANNEL_ID=${channelId}`,
		`E2E_ALICE_EMAIL=${alice.email}`,
		`E2E_ALICE_PASSWORD=${alice.password}`,
		`E2E_ALICE_USER_ID=${alice.userId}`,
		`E2E_ALICE_TOKEN=${alice.token}`,
		`E2E_BOB_EMAIL=${bob.email}`,
		`E2E_BOB_PASSWORD=${bob.password}`,
		`E2E_BOB_USER_ID=${bob.userId}`,
		`E2E_BOB_TOKEN=${bob.token}`,
		`E2E_BOB_PERSONA_ALPHA_ID=${bobAlpha.id}`,
		`E2E_BOB_PERSONA_BETA_ID=${bobBeta.id}`,
		`E2E_CAROL_EMAIL=${carol.email}`,
		`E2E_CAROL_PASSWORD=${carol.password}`,
		`E2E_CAROL_USER_ID=${carol.userId}`,
		`E2E_CAROL_TOKEN=${carol.token}`,
		`E2E_CAROL_PERSONA_ID=${carolMain.id}`,
	].join('\n');

	const envPath = resolve(process.cwd(), '.env.test');
	writeFileSync(envPath, envContent, 'utf-8');
	console.log(`[SEED] Test environment configuration written to ${envPath}`);
	console.log('✅ Seed completed successfully!');

	return result;
}

// Allow direct execution via CLI: tsx api-helpers/seed.ts
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.endsWith('seed.ts')) {
	seedTestData()
		.then(() => process.exit(0))
		.catch((err) => {
			console.error('❌ Seeding failed:', err);
			process.exit(1);
		});
}
