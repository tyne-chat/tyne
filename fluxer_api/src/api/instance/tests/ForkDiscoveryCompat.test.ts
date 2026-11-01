// SPDX-License-Identifier: AGPL-3.0-or-later

import {createAuthHarness} from '@app/api/auth/tests/AuthTestUtils';
import {forkOmitEmptyHiddenBuiltInGuildBadges} from '@app/api/instance/ForkDiscoveryCompat';
import type {ApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createBuilderWithoutAuth} from '@app/api/test/TestRequestBuilder';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

// tyne-chat/tyne#454: mobile v1.2.13 and v1.2.14 cannot parse a document that has this key.
describe('forkOmitEmptyHiddenBuiltInGuildBadges', () => {
	it('leaves out an empty list and keeps the rest', () => {
		expect(forkOmitEmptyHiddenBuiltInGuildBadges({api_code_version: 1, hidden_built_in_guild_badges: []})).toEqual({
			api_code_version: 1,
		});
	});

	it('keeps a list with something in it', () => {
		const response = {hidden_built_in_guild_badges: ['verified']};
		expect(forkOmitEmptyHiddenBuiltInGuildBadges(response)).toBe(response);
	});

	it('leaves a document without the field alone', () => {
		const response: {api_code_version: number; hidden_built_in_guild_badges?: Array<string>} = {api_code_version: 1};
		expect(forkOmitEmptyHiddenBuiltInGuildBadges(response)).toBe(response);
	});
});

describe('discovery document for phones', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createAuthHarness();
	});
	beforeEach(async () => {
		await harness.reset();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});

	it('does not carry hidden_built_in_guild_badges when no badge is hidden', async () => {
		const {json} = await createBuilderWithoutAuth<Record<string, unknown>>(harness)
			.get('/.well-known/fluxer')
			.executeWithResponse();
		expect(json).toHaveProperty('endpoints');
		expect(json).not.toHaveProperty('hidden_built_in_guild_badges');
	});
});
