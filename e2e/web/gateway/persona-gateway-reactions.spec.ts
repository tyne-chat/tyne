// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: gateway contract T2 (tyne-chat/tyne#905, plan "Personas and push", tyne-chat/tyne#120). A session
// with the DEBOUNCE_MESSAGE_REACTIONS flag (2) gets a DM's reactions merged into MESSAGE_REACTION_ADD_MANY.
// The fork keeps each reaction's persona in the merged entries, and a removal cancels only the same
// persona's buffered add. Upstream's buffer is persona-blind: its entries lose `persona_id` and
// `subprofile`, and a removal cancels the user's first buffered add whoever it came from, so "add B, add A,
// remove A" would leave A on the observer's screen while the server keeps B.
//
// Whether reactions fall into one window is timing. Every assertion here holds whether or not they did;
// each case is retried a few times to see the window form, and says in an annotation whether it did, but
// never fails only because it did not.

import {expect, test} from '@playwright/test';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {
	type Account,
	account,
	baseURL,
	community,
	createPersona,
	openDm,
	type Persona,
	react,
	reactionsOf,
	send,
	stamp,
	unreact,
} from './persona-gateway-support.js';

const DEBOUNCE_MESSAGE_REACTIONS = 2;
const ATTEMPTS = 3;
const EMOJI = '👍';
const SENTINEL_EMOJI = '🔔';

interface ReactionEntry {
	readonly kind: 'add' | 'remove';
	readonly merged: boolean;
	readonly data: any;
}

/** Every reaction add and removal the session got for a message since `from`, merged entries unpacked. */
function reactionEntries(session: GatewayRecorder, messageId: string, from: number): Array<ReactionEntry> {
	const entries: Array<ReactionEntry> = [];
	for (const event of session.events.slice(from)) {
		if (event.d?.message_id !== messageId) continue;
		if (event.t === 'MESSAGE_REACTION_ADD') entries.push({kind: 'add', merged: false, data: event.d});
		if (event.t === 'MESSAGE_REACTION_REMOVE') entries.push({kind: 'remove', merged: false, data: event.d});
		if (event.t === 'MESSAGE_REACTION_ADD_MANY') {
			for (const reaction of event.d.reactions ?? []) entries.push({kind: 'add', merged: true, data: reaction});
		}
	}
	return entries;
}

/** Who reacted: the account's id, plus the persona's for a persona's reaction. */
function reactor(data: {user_id?: string; persona_id?: string | null}): string {
	return data.persona_id ? `${data.user_id}:${data.persona_id}` : `${data.user_id}`;
}

/** The reactions the session shows for a message after applying every add and removal in order. */
function folded(entries: Array<ReactionEntry>, emoji: string): Array<string> {
	const shown = new Set<string>();
	for (const entry of entries) {
		if (entry.data?.emoji?.name !== emoji) continue;
		if (entry.kind === 'add') shown.add(reactor(entry.data));
		else shown.delete(reactor(entry.data));
	}
	return Array.from(shown).sort();
}

async function serverReactions(viewer: Account, channelId: string, messageId: string): Promise<Array<string>> {
	const users = await reactionsOf(viewer, channelId, messageId, EMOJI);
	return users.map((user) => reactor({user_id: user.id, persona_id: user.persona_id})).sort();
}

/** Waits, on events and never on time, until the session has `count` reaction adds for the message. */
async function waitForAdds(
	session: GatewayRecorder,
	messageId: string,
	from: number,
	count: number,
	timeoutMs = 15_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const adds = reactionEntries(session, messageId, from).filter((entry) => entry.kind === 'add');
		if (adds.length >= count) return;
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error(`Only ${adds.length} of ${count} reaction adds for ${messageId}`);
		const next = session.mark();
		const ofMessage = (d: any) => d?.message_id === messageId;
		const wait = Math.min(remaining, 2_000);
		await Promise.any([
			session.waitFor('MESSAGE_REACTION_ADD', ofMessage, {from: next, timeoutMs: wait}),
			session.waitFor('MESSAGE_REACTION_ADD_MANY', ofMessage, {from: next, timeoutMs: wait}),
		]).catch(() => {});
	}
}

/**
 * Adds the account's reaction to a message of its own and waits for the observer to get it. The buffer
 * hands out merged groups in the order their first reaction came in, so once this arrives, every reaction
 * sent before it has arrived too.
 */
async function sentinel(
	reactorAccount: Account,
	observer: GatewayRecorder,
	channelId: string,
	messageId: string,
	from: number,
): Promise<void> {
	await react(reactorAccount, channelId, messageId, SENTINEL_EMOJI);
	await waitForAdds(observer, messageId, from, 1);
}

interface Setup {
	readonly alice: Account;
	readonly bob: Account;
	readonly dmId: string;
	readonly personaA: Persona;
	readonly personaB: Persona;
	readonly observer: GatewayRecorder;
	readonly aliceSession: GatewayRecorder;
}

/** Alice reacts in her DM with Bob as two personas and as herself; Bob's session merges reactions. */
async function setUp(): Promise<Setup> {
	const alice = await account('alice');
	const bob = await account('bob');
	await community(alice, [bob]);
	const dmId = await openDm(alice, bob);
	const personaA = await createPersona(alice, {name: `T2 A ${stamp()}`.slice(0, 40), visibility: 'public'});
	const personaB = await createPersona(alice, {name: `T2 B ${stamp()}`.slice(0, 40), visibility: 'public'});
	// Alice's own session lets the API take her messages and reactions.
	const aliceSession = await GatewayRecorder.connect(baseURL, alice.token);
	const observer = await GatewayRecorder.connect(baseURL, bob.token, {flags: DEBOUNCE_MESSAGE_REACTIONS});
	return {alice, bob, dmId, personaA, personaB, observer, aliceSession};
}

async function tearDown(setup: Setup): Promise<void> {
	await Promise.all([setup.observer.end(), setup.aliceSession.end()]);
}

/** A target message and a sentinel message in the DM, both already seen by the observer. */
async function messages(setup: Setup): Promise<{target: string; marker: string}> {
	const target = await send(setup.alice, setup.dmId, {content: `T2 target ${stamp()}`});
	const marker = await send(setup.alice, setup.dmId, {content: `T2 sentinel ${stamp()}`});
	await setup.observer.waitFor('MESSAGE_CREATE', (d) => d?.id === marker.id, {timeoutMs: 15_000});
	return {target: target.id, marker: marker.id};
}

test.describe('persona reactions through the reaction buffer (T2)', () => {
	test('reactions as two personas and the account at once keep their personas', async () => {
		const setup = await setUp();
		const {alice, dmId, personaA, personaB, observer} = setup;
		try {
			let merged = false;
			let attempts = 0;
			for (let attempt = 1; attempt <= ATTEMPTS && !merged; attempt++) {
				attempts = attempt;
				const {target, marker} = await messages(setup);
				const from = observer.mark();
				await Promise.all([
					react(alice, dmId, target, EMOJI, personaA.id),
					react(alice, dmId, target, EMOJI, personaB.id),
					react(alice, dmId, target, EMOJI),
				]);
				await waitForAdds(observer, target, from, 3);
				await sentinel(alice, observer, dmId, marker, from);

				const entries = reactionEntries(observer, target, from);
				const adds = entries.filter((entry) => entry.kind === 'add');
				merged = adds.some((entry) => entry.merged);
				expect(adds.map((entry) => reactor(entry.data)).sort()).toEqual(
					[alice.id, `${alice.id}:${personaA.id}`, `${alice.id}:${personaB.id}`].sort(),
				);
				for (const {data} of adds) {
					if (data.persona_id) {
						expect(data.subprofile?.id, 'a persona reaction names its persona').toBe(data.persona_id);
					} else {
						// The account's own reaction carries neither key.
						expect(data).not.toHaveProperty('persona_id');
						expect(data).not.toHaveProperty('subprofile');
					}
				}
				expect(folded(entries, EMOJI)).toEqual(await serverReactions(alice, dmId, target));
			}
			test.info().annotations.push({
				type: 'reaction-window',
				description: merged
					? `MESSAGE_REACTION_ADD_MANY seen on attempt ${attempts}`
					: `no merged window in ${ATTEMPTS} attempts`,
			});
		} finally {
			await tearDown(setup);
		}
	});

	for (const order of [
		{title: 'add B, add A, remove A leaves B', first: 'B' as const},
		{title: 'add as the account, add A, remove A leaves the account', first: 'account' as const},
	]) {
		test(`a removal cancels only the same persona's buffered add: ${order.title}`, async () => {
			const setup = await setUp();
			const {alice, dmId, personaA, personaB, observer} = setup;
			try {
				let cancelledInBuffer = false;
				let attempts = 0;
				for (let attempt = 1; attempt <= ATTEMPTS && !cancelledInBuffer; attempt++) {
					attempts = attempt;
					const {target, marker} = await messages(setup);
					const from = observer.mark();
					// In order, each after the last has been handed to the gateway, close enough to share a window.
					await react(alice, dmId, target, EMOJI, order.first === 'B' ? personaB.id : undefined);
					await react(alice, dmId, target, EMOJI, personaA.id);
					await unreact(alice, dmId, target, EMOJI, personaA.id);
					await sentinel(alice, observer, dmId, marker, from);
					// The first add always reaches the observer, merged or not; wait for it in case its group
					// came out after the sentinel's.
					await waitForAdds(observer, target, from, 1);

					const entries = reactionEntries(observer, target, from);
					const server = await serverReactions(alice, dmId, target);
					expect(server).toEqual([order.first === 'B' ? `${alice.id}:${personaB.id}` : alice.id]);
					expect(folded(entries, EMOJI), 'what the observer shows matches the server').toEqual(server);
					// A's add and removal never left the buffer when the removal cancelled the add there.
					cancelledInBuffer = !entries.some((entry) => entry.data?.persona_id === personaA.id);
				}
				test.info().annotations.push({
					type: 'reaction-window',
					description: cancelledInBuffer
						? `the removal cancelled the buffered add on attempt ${attempts}`
						: `no shared window in ${ATTEMPTS} attempts`,
				});
			} finally {
				await tearDown(setup);
			}
		});
	}
});
