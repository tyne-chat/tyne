// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: gateway contract T1 (tyne-chat/tyne#905, plan "Personas and push"): persona events reach exactly
// the sessions they are meant for, and persona fields pass through the gateway untouched on messages,
// typing and single reactions.
//
// These are regression guards. Upstream's new gateway already forwards any event name and passes these
// payloads through (read in the plan); the specs pin that it keeps doing so after the port. They watch
// the gateway from the outside only (WebSocket and REST), so they judge the Erlang gateway and its
// replacement alike.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test} from '@playwright/test';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {
	type Account,
	account,
	api,
	baseURL,
	community,
	createPersona,
	openDm,
	react,
	send,
	stamp,
	unreact,
} from './persona-gateway-support.js';

/** The events an account's persona changes send to that account's own sessions, and to nobody else. */
const ACCOUNT_EVENTS = [
	'USER_PERSONA_CREATE',
	'USER_PERSONA_UPDATE',
	'USER_PERSONA_DELETE',
	'USER_PERSONAS_UPDATE',
	'USER_PERSONA_SETTINGS_UPDATE',
	'USER_PERSONA_CHANNEL_STATE_UPDATE',
	'USER_PERSONA_GROUPS_UPDATE',
] as const;

/** The members of the PluralKit fixture as the API's bulk import takes them. */
function pluralKitImport(): Array<Record<string, unknown>> {
	const file = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/pluralkit-export.json'), 'utf8'));
	return file.members.map((member: any) => ({
		name: member.name,
		pronouns: member.pronouns ?? null,
		bio: member.description ?? null,
		color: member.color ? Number.parseInt(member.color, 16) : null,
		external_uuid: member.id,
		persona_tags: (member.proxy_tags ?? []).map((tag: {prefix?: string; suffix?: string}) => ({
			...(tag.prefix ? {prefix: tag.prefix} : {}),
			...(tag.suffix ? {suffix: tag.suffix} : {}),
		})),
	}));
}

/**
 * Shows that `session` got none of the owner's account events since `from`. The sentinel is the
 * session's own account changing its persona settings: an account event on the same path, sent after
 * every event in question had been handed to the gateway, so a leaked one would have come first.
 */
async function expectNoAccountEventsOf(
	owner: Account,
	who: Account,
	session: GatewayRecorder,
	from: number,
): Promise<void> {
	await api(who.token, 'PATCH', '/users/@me/personas/settings', {multi_persona_reactions: true});
	const sentinel = {t: 'USER_PERSONA_SETTINGS_UPDATE', matches: (d: any) => d?.user_id === who.id};
	for (const name of ACCOUNT_EVENTS) {
		// Only the owner's events count: the sentinel itself is the session's own settings update.
		const ownersOnly = (d: any) =>
			name === 'USER_PERSONA_SETTINGS_UPDATE' || name === 'USER_PERSONA_DELETE'
				? d?.user_id === owner.id
				: name === 'USER_PERSONA_CREATE' || name === 'USER_PERSONA_UPDATE'
					? d?.persona?.user_id === owner.id
					: true;
		const leaked = await session.absentBefore(name, ownersOnly, sentinel, {from, timeoutMs: 15_000});
		expect(leaked, `${name} of ${owner.name} reached ${who.name}`).toEqual([]);
	}
}

test.describe('persona gateway events (T1)', () => {
	test("account persona events reach every session of the owner and nobody else's", async () => {
		const alice = await account('alice');
		const bob = await account('bob');
		const carol = await account('carol');
		const dave = await account('dave');
		// Bob shares a community and a DM with Alice, Carol only the community, Dave nothing.
		const shared = await community(alice, [bob, carol]);
		const dmId = await openDm(alice, bob);

		const aliceOne = await GatewayRecorder.connect(baseURL, alice.token, {initialGuildId: shared.guildId});
		const aliceTwo = await GatewayRecorder.connect(baseURL, alice.token);
		const bobSession = await GatewayRecorder.connect(baseURL, bob.token, {initialGuildId: shared.guildId});
		const carolSession = await GatewayRecorder.connect(baseURL, carol.token, {initialGuildId: shared.guildId});
		const daveSession = await GatewayRecorder.connect(baseURL, dave.token);
		const sessions = [aliceOne, aliceTwo, bobSession, carolSession, daveSession];
		try {
			const from = new Map(sessions.map((session) => [session, session.mark()] as const));
			const both = async (t: string, matches: (d: any) => boolean) => {
				const events = [];
				for (const session of [aliceOne, aliceTwo]) {
					events.push(await session.waitFor(t, matches, {from: from.get(session), timeoutMs: 15_000}));
				}
				return events;
			};

			const name = `T1 Persona ${stamp()}`.slice(0, 40);
			const persona = await createPersona(alice, {
				name,
				visibility: 'public',
				persona_tags: [{prefix: `t1${stamp()}:`.slice(0, 32)}],
			});
			for (const event of await both('USER_PERSONA_CREATE', (d) => d?.persona?.id === persona.id)) {
				expect(event.d.persona.name).toBe(name);
				expect(event.d.persona.user_id).toBe(alice.id);
			}

			const renamed = `${name} renamed`.slice(0, 60);
			await api(alice.token, 'PATCH', `/users/@me/personas/${persona.id}`, {name: renamed});
			await both('USER_PERSONA_UPDATE', (d) => d?.persona?.id === persona.id && d.persona.name === renamed);

			await api(alice.token, 'PATCH', '/users/@me/personas/settings', {active_persona_mode: 'last'});
			await both('USER_PERSONA_SETTINGS_UPDATE', (d) => d?.user_id === alice.id && d.active_persona_mode === 'last');

			await api(alice.token, 'PUT', `/users/@me/personas/channel-states/${dmId}`, {persona_id: persona.id});
			await both('USER_PERSONA_CHANNEL_STATE_UPDATE', (d) => d?.channel_id === dmId && d.persona_id === persona.id);

			const group = await api(alice.token, 'POST', '/users/@me/personas/groups', {
				name: `T1 group ${stamp()}`.slice(0, 40),
				persona_ids: [persona.id],
			});
			await both('USER_PERSONA_GROUPS_UPDATE', (d) =>
				(d?.groups ?? []).some((g: any) => g.id === group.id && g.persona_ids.includes(persona.id)),
			);

			const items = pluralKitImport();
			await api(alice.token, 'POST', '/users/@me/personas/import', items);
			const importedNames = items.map((item) => item.name);
			for (const event of await both('USER_PERSONAS_UPDATE', (d) =>
				importedNames.every((n) => (d?.personas ?? []).some((p: any) => p.name === n)),
			)) {
				// The whole list: the imported personas and the one made above.
				expect(event.d.personas.map((p: any) => p.id)).toContain(persona.id);
			}

			await api(alice.token, 'DELETE', `/users/@me/personas/${persona.id}`);
			await both('USER_PERSONA_DELETE', (d) => d?.persona_id === persona.id && d.user_id === alice.id);

			// A DM partner, a community member and a stranger get none of them.
			await expectNoAccountEventsOf(alice, bob, bobSession, from.get(bobSession)!);
			await expectNoAccountEventsOf(alice, carol, carolSession, from.get(carolSession)!);
			await expectNoAccountEventsOf(alice, dave, daveSession, from.get(daveSession)!);
		} finally {
			await Promise.all(sessions.map((session) => session.end()));
		}
	});

	test('GUILD_PERSONAS_DIRTY reaches a community member and a DM partner, and not a stranger', async () => {
		const alice = await account('alice');
		const bob = await account('bob');
		const carol = await account('carol');
		const dave = await account('dave');
		const shared = await community(alice, [bob, carol]);
		await openDm(alice, bob);

		const bobSession = await GatewayRecorder.connect(baseURL, bob.token, {initialGuildId: shared.guildId});
		const carolSession = await GatewayRecorder.connect(baseURL, carol.token, {initialGuildId: shared.guildId});
		const daveSession = await GatewayRecorder.connect(baseURL, dave.token);
		const sessions = [bobSession, carolSession, daveSession];
		try {
			const carolFrom = carolSession.mark();
			const daveFrom = daveSession.mark();
			// The DM path carries no guild_id; the community path carries the community's.
			const throughDm = (d: any) => d?.user_id === alice.id && d.guild_id === undefined;
			const throughCommunity = (d: any) => d?.user_id === alice.id && d.guild_id === shared.guildId;
			// Each step looks only at what came after it started, so a step never matches an earlier one's event.
			const expectDirty = async (change: () => Promise<{id: string}>, action: string, personaName?: string) => {
				const bobStep = bobSession.mark();
				const carolStep = carolSession.mark();
				const {id} = await change();
				const viaDm = await bobSession.waitFor(
					'GUILD_PERSONAS_DIRTY',
					(d) => throughDm(d) && d.persona?.id === id && d.action === action,
					{from: bobStep, timeoutMs: 15_000},
				);
				const viaCommunity = await carolSession.waitFor(
					'GUILD_PERSONAS_DIRTY',
					(d) => throughCommunity(d) && d.persona?.id === id && d.action === action,
					{from: carolStep, timeoutMs: 15_000},
				);
				if (personaName !== undefined) {
					expect(viaDm.d.persona.name).toBe(personaName);
					expect(viaCommunity.d.persona.name).toBe(personaName);
				}
				return id;
			};

			const name = `T1 Dirty ${stamp()}`.slice(0, 40);
			const personaId = await expectDirty(() => createPersona(alice, {name, visibility: 'public'}), 'update', name);

			const renamed = `${name} renamed`.slice(0, 60);
			await expectDirty(
				async () => api(alice.token, 'PATCH', `/users/@me/personas/${personaId}`, {name: renamed}),
				'update',
				renamed,
			);

			await expectDirty(async () => {
				await api(alice.token, 'DELETE', `/users/@me/personas/${personaId}`);
				return {id: personaId};
			}, 'delete');

			// Carol has no DM with Alice, so nothing reaches her on the DM path; Dave gets nothing at all.
			const sentinel = (who: Account) => ({
				t: 'USER_PERSONA_SETTINGS_UPDATE',
				matches: (d: any) => d?.user_id === who.id,
			});
			await api(carol.token, 'PATCH', '/users/@me/personas/settings', {multi_persona_reactions: true});
			expect(
				await carolSession.absentBefore('GUILD_PERSONAS_DIRTY', throughDm, sentinel(carol), {from: carolFrom}),
			).toEqual([]);
			await api(dave.token, 'PATCH', '/users/@me/personas/settings', {multi_persona_reactions: true});
			expect(
				await daveSession.absentBefore('GUILD_PERSONAS_DIRTY', (d) => d?.user_id === alice.id, sentinel(dave), {
					from: daveFrom,
				}),
			).toEqual([]);
		} finally {
			await Promise.all(sessions.map((session) => session.end()));
		}
	});

	test('persona fields pass through on MESSAGE_CREATE, TYPING_START and single reactions', async () => {
		const alice = await account('alice');
		const bob = await account('bob');
		const carol = await account('carol');
		const shared = await community(alice, [bob, carol]);
		const dmId = await openDm(alice, bob);
		const speaker = await createPersona(alice, {name: `T1 Speaker ${stamp()}`.slice(0, 40), visibility: 'public'});
		const mentioned = await createPersona(bob, {name: `T1 Mentioned ${stamp()}`.slice(0, 40), visibility: 'public'});

		// Alice's own session lets the API take her messages and reactions.
		const aliceSession = await GatewayRecorder.connect(baseURL, alice.token, {initialGuildId: shared.guildId});
		const bobSession = await GatewayRecorder.connect(baseURL, bob.token, {initialGuildId: shared.guildId});
		const carolSession = await GatewayRecorder.connect(baseURL, carol.token, {initialGuildId: shared.guildId});
		const sessions = [aliceSession, bobSession, carolSession];
		try {
			const bobFrom = bobSession.mark();
			const carolFrom = carolSession.mark();
			const inCommunity = [
				[bobSession, bobFrom],
				[carolSession, carolFrom],
			] as const;

			// MESSAGE_CREATE in a community channel (community path), with a persona mention.
			const content = `<@${bob.id}:${mentioned.id}> T1 hello ${stamp()}`;
			const message = await send(alice, shared.channelId, {content, persona_id: speaker.id});
			for (const [session, from] of inCommunity) {
				const created = await session.waitFor('MESSAGE_CREATE', (d) => d?.id === message.id, {
					from,
					timeoutMs: 15_000,
				});
				expect(created.d.subprofile?.id).toBe(speaker.id);
				expect(created.d.subprofile?.name).toBe(speaker.name);
				expect((created.d.mention_personas ?? []).map((p: any) => p.id)).toContain(mentioned.id);
			}

			// MESSAGE_CREATE in a DM (the recipient's account path).
			const dmMessage = await send(alice, dmId, {content: `T1 dm ${stamp()}`, persona_id: speaker.id});
			const dmCreated = await bobSession.waitFor('MESSAGE_CREATE', (d) => d?.id === dmMessage.id, {
				from: bobFrom,
				timeoutMs: 15_000,
			});
			expect(dmCreated.d.subprofile?.id).toBe(speaker.id);

			// TYPING_START, on both paths.
			await api(alice.token, 'POST', `/channels/${shared.channelId}/typing`, {persona_id: speaker.id});
			for (const [session, from] of inCommunity) {
				await session.waitFor(
					'TYPING_START',
					(d) => d?.channel_id === shared.channelId && d.user_id === alice.id && d.subprofile?.id === speaker.id,
					{from, timeoutMs: 15_000},
				);
			}
			await api(alice.token, 'POST', `/channels/${dmId}/typing`, {persona_id: speaker.id});
			await bobSession.waitFor(
				'TYPING_START',
				(d) => d?.channel_id === dmId && d.user_id === alice.id && d.subprofile?.id === speaker.id,
				{from: bobFrom, timeoutMs: 15_000},
			);

			// Single reactions as the persona (no DEBOUNCE flag, so no batching), on both paths.
			const emoji = '👍';
			const reactionOf = (channelId: string, messageId: string) => (d: any) =>
				d?.channel_id === channelId && d.message_id === messageId && d.user_id === alice.id;
			await react(alice, shared.channelId, message.id, emoji, speaker.id);
			for (const [session, from] of inCommunity) {
				const added = await session.waitFor('MESSAGE_REACTION_ADD', reactionOf(shared.channelId, message.id), {
					from,
					timeoutMs: 15_000,
				});
				expect(added.d.persona_id).toBe(speaker.id);
				expect(added.d.subprofile?.id).toBe(speaker.id);
			}
			await unreact(alice, shared.channelId, message.id, emoji, speaker.id);
			for (const [session, from] of inCommunity) {
				const removed = await session.waitFor('MESSAGE_REACTION_REMOVE', reactionOf(shared.channelId, message.id), {
					from,
					timeoutMs: 15_000,
				});
				expect(removed.d.persona_id).toBe(speaker.id);
			}

			await react(alice, dmId, dmMessage.id, emoji, speaker.id);
			const dmAdded = await bobSession.waitFor('MESSAGE_REACTION_ADD', reactionOf(dmId, dmMessage.id), {
				from: bobFrom,
				timeoutMs: 15_000,
			});
			expect(dmAdded.d.persona_id).toBe(speaker.id);
			expect(dmAdded.d.subprofile?.id).toBe(speaker.id);
			await unreact(alice, dmId, dmMessage.id, emoji, speaker.id);
			const dmRemoved = await bobSession.waitFor('MESSAGE_REACTION_REMOVE', reactionOf(dmId, dmMessage.id), {
				from: bobFrom,
				timeoutMs: 15_000,
			});
			expect(dmRemoved.d.persona_id).toBe(speaker.id);
		} finally {
			await Promise.all(sessions.map((session) => session.end()));
		}
	});
});
