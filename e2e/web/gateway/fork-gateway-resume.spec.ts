// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: gateway contract T6 (tyne-chat/tyne#905). The fork's gateway keeps a dropped session for RESUME for
// 300 s (constants:resume_timeout/0); upstream's new gateway keeps it for 60 s. The web app resumes for up to
// 180 s, so the longer hold is what spares it a fresh IDENTIFY after a short outage. A RESUME 75 s after the drop
// tells the two apart: it must get RESUMED and every event sent meanwhile, replayed in order.
//
// The connection is dropped with close 4000, as a network failure would leave it: a close with 1000 or 1001 ends
// the session at once. The 75 s hold is the point of the test and its only wait on the clock; the 310 s case
// (the hold has ended) becomes a unit test after the port.

import {expect, test} from '@playwright/test';
import {GatewayRecorder} from '../../api-helpers/gateway-recorder.js';
import {account, baseURL, community, renameCommunity} from './fork-gateway-support.js';

const HOLD_MS = 75_000;

test.describe('gateway contract: RESUME after a long drop (T6)', () => {
	test('@slow a session dropped with 4000 resumes after 75 s and gets the events sent meanwhile', async () => {
		test.setTimeout(HOLD_MS + 90_000);
		const owner = await account('t6owner');
		const {guildId} = await community(owner, [], 't6');
		const session = await GatewayRecorder.connect(baseURL, owner.token, {initialGuildId: guildId});
		try {
			const sessionId = session.sessionId;
			expect(sessionId).toBeTruthy();

			await session.drop(4000);
			expect(session.lastClose?.code).toBe(4000);
			const droppedAt = Date.now();

			// One event just after the drop, one at the end of the hold: both must be replayed.
			const early = await renameCommunity(owner, guildId, 't6 early');
			await new Promise((resolve) => setTimeout(resolve, Math.max(0, droppedAt + HOLD_MS - Date.now())));
			const late = await renameCommunity(owner, guildId, 't6 late');

			const from = session.mark();
			expect(await session.resume()).toBe('RESUMED');
			expect(session.sessionId).toBe(sessionId);
			const replayedEarly = await session.waitFor('GUILD_UPDATE', (d) => d.id === guildId && d.name === early, {from});
			const replayedLate = await session.waitFor('GUILD_UPDATE', (d) => d.id === guildId && d.name === late, {from});
			expect(replayedEarly.s).not.toBeNull();
			expect(replayedLate.s).not.toBeNull();
			expect(replayedEarly.s as number).toBeLessThan(replayedLate.s as number);
			// A resumed session goes on where it was: no second READY.
			expect(session.all('READY', () => true, from)).toEqual([]);
		} finally {
			await session.end();
		}
	});
});
