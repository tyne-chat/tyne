// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: gateway contract T4 (tyne-chat/tyne#905). The signal bar's channel events, CHANNEL_SIGNAL_UPDATE and
// CHANNEL_SIGNAL_BAR_UPDATE, reach only the members who can see the channel. The fork's gateway scopes them like
// messages (guild_dispatch_filter.erl); upstream's new gateway sends unknown events community-wide, so without
// the port a member would learn of signals in a private channel they cannot see. Both directions are pinned: a
// member without access gets neither event for the private channel, a member with access gets both, and the
// member without access still gets both for a channel they can see (so the absence is the scoping, not a
// session that hears nothing).

import {expect, test} from '@playwright/test';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {
	account,
	api,
	baseURL,
	community,
	ensureSignalBar,
	lightSignal,
	renameCommunity,
	SEND_MESSAGES,
	type SignalBarHandle,
	stamp,
	switchSignalBar,
	VIEW_CHANNEL,
} from './fork-gateway-support.js';

const SIGNAL_EVENTS = ['CHANNEL_SIGNAL_UPDATE', 'CHANNEL_SIGNAL_BAR_UPDATE'] as const;

test.describe('gateway contract: signal events follow channel access (T4)', () => {
	let bar: SignalBarHandle;

	test.beforeAll(async () => {
		bar = await ensureSignalBar();
	});

	test.afterAll(async () => {
		await bar?.restore();
	});

	test('a member who cannot see a private channel gets neither signal event for it; one who can gets both', async () => {
		const owner = await account('t4owner');
		const outsider = await account('t4out');
		const insider = await account('t4in');
		const {guildId, channelId: publicChannelId} = await community(owner, [outsider, insider], 't4');

		// The private channel: @everyone may not view it, a role held only by the insider may.
		const role = await api(owner.token, 'POST', `/guilds/${guildId}/roles`, {name: `insiders ${stamp()}`});
		await api(owner.token, 'PUT', `/guilds/${guildId}/members/${insider.id}/roles/${role.id}`);
		const privateChannel = await api(owner.token, 'POST', `/guilds/${guildId}/channels`, {
			name: `private-${stamp()}`,
			type: 0,
			permission_overwrites: [
				{id: guildId, type: 0, deny: VIEW_CHANNEL.toString()},
				{id: role.id, type: 0, allow: (VIEW_CHANNEL | SEND_MESSAGES).toString()},
			],
		});
		const privateChannelId: string = privateChannel.id;

		// Both sessions are active in the community from IDENTIFY, so no passive rule applies.
		const outsiderSession = await GatewayRecorder.connect(baseURL, outsider.token, {initialGuildId: guildId});
		const insiderSession = await GatewayRecorder.connect(baseURL, insider.token, {initialGuildId: guildId});
		try {
			const outsiderFrom = outsiderSession.mark();
			const insiderFrom = insiderSession.mark();

			// The bar goes on in both channels: one CHANNEL_SIGNAL_BAR_UPDATE each.
			await switchSignalBar(owner, guildId, [privateChannelId, publicChannelId]);
			// A signal lights in each: one CHANNEL_SIGNAL_UPDATE each.
			await lightSignal(insider, privateChannelId, bar.signalId);
			await lightSignal(outsider, publicChannelId, bar.signalId);
			// The sentinel: the community's events reach a session in order, and both get the rename.
			const newName = await renameCommunity(owner, guildId, 't4 renamed');
			const sentinel = {t: 'GUILD_UPDATE', matches: (d: any) => d.id === guildId && d.name === newName};

			// The member who can see the private channel gets both events for it.
			const barUpdate = await insiderSession.waitFor(
				'CHANNEL_SIGNAL_BAR_UPDATE',
				(d) => d.channel_id === privateChannelId,
				{from: insiderFrom},
			);
			expect(barUpdate.d.enabled).toBe(true);
			const signalUpdate = await insiderSession.waitFor(
				'CHANNEL_SIGNAL_UPDATE',
				(d) => d.channel_id === privateChannelId,
				{from: insiderFrom},
			);
			expect(signalUpdate.d.added.map((entry: any) => entry.user.id)).toContain(insider.id);
			await insiderSession.waitFor(sentinel.t, sentinel.matches, {from: insiderFrom});

			// The member who cannot see it gets neither, though both came before the rename it did get...
			for (const t of SIGNAL_EVENTS) {
				const leaked = await outsiderSession.absentBefore(t, (d) => d.channel_id === privateChannelId, sentinel, {
					from: outsiderFrom,
				});
				expect(leaked, `${t} for the private channel reached a member who cannot see it`).toEqual([]);
			}
			// ...and gets both for the channel they can see, so the session was listening all along.
			for (const t of SIGNAL_EVENTS) {
				const seen = outsiderSession.all(t, (d) => d.channel_id === publicChannelId, outsiderFrom);
				expect(seen.length, `${t} for the public channel`).toBeGreaterThan(0);
			}
		} finally {
			await outsiderSession.end();
			await insiderSession.end();
		}
	});
});
