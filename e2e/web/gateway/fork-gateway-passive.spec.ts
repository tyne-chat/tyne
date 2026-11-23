// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: gateway contract T5 (tyne-chat/tyne#905). In a community of more than 250 members a session is passive
// until its client sends Lazy Request (op 14), except in IDENTIFY's initial_guild_id. The fork lets two of its
// community-wide events through to passive sessions, SIGNAL_BAR_UPDATE and GUILD_COMMANDS_UPDATE
// (fluxer_gateway's fork/events.gleam); upstream's gateway alone drops them. An active session gets those
// two and the channel-scoped CHANNEL_SIGNAL_UPDATE and CHANNEL_SIGNAL_BAR_UPDATE.
//
// The passive session missing CHANNEL_SIGNAL_UPDATE and CHANNEL_SIGNAL_BAR_UPDATE is a known gap,
// tyne-chat/tyne#313, pinned here as it is so the port keeps it unchanged. When #313 is fixed, this expectation
// changes with it.
//
// The passive rules only start above 250 members (session_passive:is_small_guild/1), so the community gets real
// members through the API, and each test checks that the gateway counts more than 250 before it trusts an absence.

import {expect, test} from '@playwright/test';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {
	type Account,
	account,
	api,
	baseURL,
	community,
	ensureSignalBar,
	lightSignal,
	mapLimit,
	renameCommunity,
	type SignalBarHandle,
	stamp,
	switchSignalBar,
} from './fork-gateway-support.js';

/** Members added on top of the owner and the two session accounts: 254 in all, over the 250 limit. */
const EXTRA_MEMBERS = 251;
const REGISTRATION_CONCURRENCY = 10;
const PASSIVE_LIMIT = 250;

/** The member count the gateway reports for the community: from READY's guild entry, else its GUILD_CREATE. */
async function memberCountSeen(session: GatewayRecorder, guildId: string): Promise<number> {
	const ready = session.all('READY')[0];
	const fromReady = (ready?.d?.guilds ?? []).find((g: any) => g?.id === guildId && typeof g.member_count === 'number');
	if (fromReady) {
		console.log(`[T5] READY gives member_count ${fromReady.member_count}`);
		return fromReady.member_count;
	}
	const created = await session.waitFor('GUILD_CREATE', (d) => d.id === guildId && typeof d.member_count === 'number');
	console.log(`[T5] GUILD_CREATE gives member_count ${created.d.member_count}`);
	return created.d.member_count;
}

test.describe('gateway contract: passive sessions in a community over 250 members (T5)', () => {
	let bar: SignalBarHandle;
	let owner: Account;
	let activeMember: Account;
	let passiveMember: Account;
	let guildId: string;

	test.beforeAll(async () => {
		test.setTimeout(600_000);
		bar = await ensureSignalBar();
		owner = await account('t5owner');
		activeMember = await account('t5active');
		passiveMember = await account('t5passive');
		const big = await community(owner, [activeMember, passiveMember], 't5 big');
		guildId = big.guildId;

		const started = Date.now();
		await mapLimit(
			Array.from({length: EXTRA_MEMBERS}, (_, i) => i),
			REGISTRATION_CONCURRENCY,
			async (i) => {
				const member = await account(`t5m${i}`);
				await member.client.acceptInvite(big.inviteCode);
			},
		);
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		console.log(
			`[T5] registered and joined ${EXTRA_MEMBERS} members, ${REGISTRATION_CONCURRENCY} at a time, in ${seconds} s`,
		);
	});

	test.afterAll(async () => {
		await bar?.restore();
	});

	/**
	 * Sends the four events to the community, then the rename that serves as the sentinel: a new channel with the
	 * bar switched on (CHANNEL_SIGNAL_BAR_UPDATE), a signal lit in it (CHANNEL_SIGNAL_UPDATE), a bar write
	 * (SIGNAL_BAR_UPDATE) and a new command (GUILD_COMMANDS_UPDATE).
	 */
	async function sendTheFourEvents(): Promise<{channelId: string; sentinelName: string}> {
		const channel = await api(owner.token, 'POST', `/guilds/${guildId}/channels`, {
			name: `signals-${stamp()}`,
			type: 0,
		});
		await switchSignalBar(owner, guildId, [channel.id]);
		await lightSignal(owner, channel.id, bar.signalId);
		await bar.touch();
		await api(owner.token, 'POST', `/guilds/${guildId}/commands`, {
			name: `gw${stamp()}`.slice(0, 32),
			template: 'contract',
			input_mode: 'none',
		});
		const sentinelName = await renameCommunity(owner, guildId, 't5 renamed');
		return {channelId: channel.id, sentinelName};
	}

	test('a passive session gets SIGNAL_BAR_UPDATE and GUILD_COMMANDS_UPDATE but not the channel signal events (#313)', async () => {
		// A raw socket with no initial_guild_id that never sends op 14: passive in the community.
		const session = await GatewayRecorder.connect(baseURL, passiveMember.token);
		try {
			expect(await memberCountSeen(session, guildId)).toBeGreaterThan(PASSIVE_LIMIT);
			const from = session.mark();
			const {channelId, sentinelName} = await sendTheFourEvents();
			const sentinel = {t: 'GUILD_UPDATE', matches: (d: any) => d.id === guildId && d.name === sentinelName};

			await session.waitFor('SIGNAL_BAR_UPDATE', () => true, {from});
			await session.waitFor('GUILD_COMMANDS_UPDATE', (d) => d.guild_id === guildId, {from});
			// tyne-chat/tyne#313: a passive session misses both channel signal events (pinned as it is).
			for (const t of ['CHANNEL_SIGNAL_UPDATE', 'CHANNEL_SIGNAL_BAR_UPDATE']) {
				const got = await session.absentBefore(t, (d) => d.channel_id === channelId, sentinel, {from});
				expect(got, `${t} reached a passive session`).toEqual([]);
			}
		} finally {
			await session.end();
		}
	});

	test('an active session gets all four', async () => {
		const session = await GatewayRecorder.connect(baseURL, activeMember.token, {initialGuildId: guildId});
		try {
			expect(await memberCountSeen(session, guildId)).toBeGreaterThan(PASSIVE_LIMIT);
			const from = session.mark();
			const {channelId} = await sendTheFourEvents();

			await session.waitFor('SIGNAL_BAR_UPDATE', () => true, {from});
			await session.waitFor('GUILD_COMMANDS_UPDATE', (d) => d.guild_id === guildId, {from});
			const barUpdate = await session.waitFor('CHANNEL_SIGNAL_BAR_UPDATE', (d) => d.channel_id === channelId, {from});
			expect(barUpdate.d.enabled).toBe(true);
			const signalUpdate = await session.waitFor('CHANNEL_SIGNAL_UPDATE', (d) => d.channel_id === channelId, {from});
			expect(signalUpdate.d.added.map((entry: any) => entry.user.id)).toContain(owner.id);
		} finally {
			await session.end();
		}
	});
});
