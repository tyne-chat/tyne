// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: checks the gateway contract helpers themselves (tyne-chat/tyne#905): the raw gateway client sees
// a community event and an account event, a dropped session resumes, and the push sink receives the push
// for a DM to an account with no session. The fork's gateway specs build on these.

import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {PushSink} from '../../api-helpers/push-sink.js';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

async function account(label: string): Promise<{client: FluxerApiClient; id: string; token: string}> {
	const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
	const client = new FluxerApiClient(baseURL);
	const auth = await client.register({
		username: `gw_${label}_${stamp}`.slice(0, 32),
		email: `gw_${label}_${stamp}@test.local`,
		password: 'TestPassword123!',
		global_name: `GW ${label}`,
	});
	client.setToken(auth.token);
	const me = await client.getMe();
	return {client, id: me.id, token: auth.token};
}

async function api(token: string, method: string, path: string, body?: unknown): Promise<any> {
	const response = await fetch(`${baseURL}/api/v1${path}`, {
		method,
		headers: {Authorization: token, 'Content-Type': 'application/json'},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
	return text ? JSON.parse(text) : null;
}

test.describe('gateway contract helpers', () => {
	test('see community and account events, resume a dropped session, and catch a DM push', async () => {
		const alice = await account('alice');
		const bob = await account('bob');

		const guild = await alice.client.createGuild(`Gateway contract ${Date.now().toString(36)}`);
		// Sharing a community lets Bob open a DM with Alice.
		const channels = await alice.client.getGuildChannels(guild.id);
		const invite = await alice.client.createInvite((channels.find((c) => c.type === 0) ?? channels[0]).id);
		await bob.client.acceptInvite(invite.code);
		const aliceSession = await GatewayRecorder.connect(baseURL, alice.token, {initialGuildId: guild.id});
		try {
			// Community path: a rename reaches the owner's session.
			const before = aliceSession.mark();
			await api(alice.token, 'PATCH', `/guilds/${guild.id}`, {name: 'Renamed for the contract'});
			const update = await aliceSession.waitFor('GUILD_UPDATE', (d) => d.id === guild.id, {from: before});
			expect(update.d.name).toBe('Renamed for the contract');

			// Account path: a fork event reaches the account's session.
			const persona = await alice.client.createPersona({name: 'Contract Persona', persona_tags: [{prefix: 'cp:'}]});
			await aliceSession.waitFor('USER_PERSONA_CREATE', (d) => d.id === persona.id || d.persona?.id === persona.id);

			// A dropped connection resumes, and nothing sent meanwhile is lost.
			await aliceSession.drop(4000);
			await api(alice.token, 'PATCH', `/guilds/${guild.id}`, {name: 'Renamed while away'});
			const resumeFrom = aliceSession.mark();
			expect(await aliceSession.resume()).toBe('RESUMED');
			await aliceSession.waitFor('GUILD_UPDATE', (d) => d.name === 'Renamed while away', {from: resumeFrom});
		} finally {
			await aliceSession.end();
		}

		// Push: Alice has no session now, so Bob's DM becomes a push job.
		const sink = await PushSink.start();
		try {
			const dm = await api(bob.token, 'POST', '/users/@me/channels', {recipient_id: alice.id});
			const content = `push contract ${Date.now().toString(36)}`;
			await bob.client.sendMessage(dm.id, content);
			const job = await sink.waitFor((j) => JSON.stringify(j.body).includes(content), 20_000);
			expect(job.subject).toBe('push.job.message');
			expect(JSON.stringify(job.body)).toContain(alice.id);
		} finally {
			sink.stop();
		}
	});
});
