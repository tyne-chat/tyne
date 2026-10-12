// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's desktop app, Tyne, registers tyne:// and not fluxer://, so the link that
// returns a browser sign-in to it is tyne://handoff. The instance has to accept it next to
// upstream's.

import {HandoffInitiateRequest} from '@fluxer/schema/src/domains/auth/AuthSchemas';
import {describe, expect, it} from 'vitest';

describe('the return link of a browser sign-in', () => {
	it("accepts Tyne's link and upstream's", () => {
		for (const link of [
			'tyne://handoff',
			'fluxer://handoff',
			'fluxer-canary://handoff',
			'fluxer-development://handoff',
		]) {
			expect(HandoffInitiateRequest.safeParse({return_uri: link}).success, link).toBe(true);
		}
	});

	it('accepts nothing that only resembles them', () => {
		for (const link of [
			'tyne://handoff/',
			'tyne://handoff?code=1',
			'tyne://other',
			'tyne-canary://handoff',
			'xtyne://handoff',
			'tynex://handoff',
			'https://tyne.chat/handoff',
			'fluxer://handoff\ntyne://handoff',
		]) {
			expect(HandoffInitiateRequest.safeParse({return_uri: link}).success, link).toBe(false);
		}
	});
});
