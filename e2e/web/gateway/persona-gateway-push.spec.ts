// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: gateway contract T3 (tyne-chat/tyne#905, plan "Personas and push"). When a message from a persona
// becomes a push, the gateway names the persona: the title and `author_name` are the persona's name, the
// icon is the persona's picture (stored under its account, so the address is built from the author's user
// id and the persona's hash), and the preview names a mentioned persona. What a persona lacks comes from
// its account. Upstream's new gateway drops `subprofile` and `mention_personas` from the message it builds
// pushes from, so all of this is to be ported.
//
// The recipient never opens a session, so every message to them becomes a push job; the push sink answers
// the jobs in place of the push service and keeps them. A job, as captured from the Erlang gateway on the
// E2E stack (push_job_publisher.erl, push_job_fields.erl):
//
//   {v: 1, config_version: 0, guild_id ("0" for a DM), channel_id, message_id, user_ids: [...],
//    notification: {title, body, icon, image_url, author_name, conversation_kind ("dm", "group_dm" or
//    "guild"), guild_name and conversation_name (the channel) in a community, tag, notification_tag, url}}
//
// with `icon` = <media endpoint>/avatars/<user id>/<hash>.png (and `badge` too on a non-self-hosted
// instance).

import {expect, test} from '@playwright/test';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {type PushJob, PushSink} from '../../api-helpers/push-sink.js';
import {
	ACCOUNT_PNG,
	type Account,
	account,
	api,
	baseURL,
	community,
	createPersona,
	openDm,
	send,
	stamp,
	uploadPersonaAvatar,
} from './persona-gateway-support.js';

/** The push job for one message to one recipient. */
function jobFor(sink: PushSink, messageId: string, recipient: Account): Promise<PushJob> {
	return sink.waitFor(
		(job) =>
			job.subject === 'push.job.message' &&
			job.body?.message_id === messageId &&
			(job.body.user_ids ?? []).includes(recipient.id),
		20_000,
	);
}

/** The address the gateway gives a picture stored under `userId` with `hash`, after the media endpoint. */
function avatarPath(userId: string, hash: string): string {
	return `/avatars/${userId}/${hash}.png`;
}

test.describe('persona push notifications (T3)', () => {
	test('a DM push names the persona, shows its picture and names mentioned personas', async () => {
		const alice = await account('alice');
		const bob = await account('bob');
		await community(alice, [bob]);
		const dmId = await openDm(alice, bob);

		const me = await api(alice.token, 'PATCH', '/users/@me', {avatar: ACCOUNT_PNG});
		const accountHash: string = me.avatar;
		expect(accountHash, 'the account has a picture of its own').toBeTruthy();
		const personaHash = await uploadPersonaAvatar(alice);
		expect(personaHash).not.toBe(accountHash);
		const pictured = await createPersona(alice, {
			name: `T3 Pictured ${stamp()}`.slice(0, 40),
			avatar_hash: personaHash,
			visibility: 'public',
		});
		const plain = await createPersona(alice, {name: `T3 Plain ${stamp()}`.slice(0, 40), visibility: 'public'});
		const bobPersona = await createPersona(bob, {name: `T3 Mentioned ${stamp()}`.slice(0, 40), visibility: 'public'});

		// Alice's session lets the API take her messages. Bob never connects, so each message pushes.
		const aliceSession = await GatewayRecorder.connect(baseURL, alice.token);
		const sink = await PushSink.start();
		try {
			// As a persona with a picture: its name, and its picture under Alice's user id.
			const asPictured = await send(alice, dmId, {content: `T3 pictured ${stamp()}`, persona_id: pictured.id});
			const picturedJob = (await jobFor(sink, asPictured.id, bob)).body;
			expect(picturedJob.channel_id).toBe(dmId);
			expect(picturedJob.notification.conversation_kind).toBe('dm');
			expect(picturedJob.notification.title).toBe(pictured.name);
			expect(picturedJob.notification.author_name).toBe(pictured.name);
			expect(picturedJob.notification.icon).toMatch(/^https?:\/\//);
			expect(picturedJob.notification.icon.endsWith(avatarPath(alice.id, personaHash))).toBe(true);

			// As the account: the account's name and picture.
			const asAccount = await send(alice, dmId, {content: `T3 account ${stamp()}`});
			const accountJob = (await jobFor(sink, asAccount.id, bob)).body;
			expect(accountJob.notification.title).toBe(alice.name);
			expect(accountJob.notification.author_name).toBe(alice.name);
			expect(accountJob.notification.icon.endsWith(avatarPath(alice.id, accountHash))).toBe(true);

			// As a persona without a picture: its name, and the account's picture.
			const asPlain = await send(alice, dmId, {content: `T3 plain ${stamp()}`, persona_id: plain.id});
			const plainJob = (await jobFor(sink, asPlain.id, bob)).body;
			expect(plainJob.notification.title).toBe(plain.name);
			expect(plainJob.notification.author_name).toBe(plain.name);
			expect(plainJob.notification.icon).toBe(accountJob.notification.icon);

			// The preview names a mentioned persona.
			const mention = await send(alice, dmId, {content: `<@${bob.id}:${bobPersona.id}> T3 mention ${stamp()}`});
			const mentionJob = (await jobFor(sink, mention.id, bob)).body;
			expect(mentionJob.notification.body).toContain(`@${bobPersona.name}`);

			// A persona mention the message does not list (not one of Bob's) names the account instead.
			const unlisted = await send(alice, dmId, {content: `<@${bob.id}:${plain.id}> T3 unlisted ${stamp()}`});
			const unlistedJob = (await jobFor(sink, unlisted.id, bob)).body;
			expect(unlistedJob.notification.body).toContain(`@${bob.name}`);
			expect(unlistedJob.notification.body).not.toContain(plain.name);
		} finally {
			sink.stop();
			await aliceSession.end();
		}
	});

	test('a community push is titled "Persona (#channel, Community)"', async () => {
		const alice = await account('alice');
		const bob = await account('bob');
		const shared = await community(alice, [bob]);
		const personaHash = await uploadPersonaAvatar(alice);
		const pictured = await createPersona(alice, {
			name: `T3 Speaker ${stamp()}`.slice(0, 40),
			avatar_hash: personaHash,
			visibility: 'public',
		});

		const aliceSession = await GatewayRecorder.connect(baseURL, alice.token, {initialGuildId: shared.guildId});
		const sink = await PushSink.start();
		try {
			// A mention makes the message push whatever Bob's notification level in the community.
			const message = await send(alice, shared.channelId, {
				content: `<@${bob.id}> T3 community ${stamp()}`,
				persona_id: pictured.id,
			});
			const job = (await jobFor(sink, message.id, bob)).body;
			expect(job.guild_id).toBe(shared.guildId);
			expect(job.notification.conversation_kind).toBe('guild');
			expect(job.notification.title).toBe(`${pictured.name} (#${shared.channelName}, ${shared.guildName})`);
			expect(job.notification.author_name).toBe(pictured.name);
			expect(job.notification.guild_name).toBe(shared.guildName);
			expect(job.notification.conversation_name).toBe(shared.channelName);
			expect(job.notification.icon.endsWith(avatarPath(alice.id, personaHash))).toBe(true);
		} finally {
			sink.stop();
			await aliceSession.end();
		}
	});
});
