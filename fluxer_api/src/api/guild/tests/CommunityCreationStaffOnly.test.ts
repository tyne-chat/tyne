// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {getInstanceConfigRepository} from '@app/api/middleware/ServiceSingletons';
import type {ApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {UserFlags} from '@fluxer/constants/src/UserConstants';
import type {GuildResponse} from '@fluxer/schema/src/domains/guild/GuildResponseSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

async function setUserFlags(harness: ApiTestHarness, userId: string, flags: bigint): Promise<void> {
	await createBuilder(harness, '')
		.patch(`/test/users/${userId}/flags`)
		.body({flags: flags.toString()})
		.expect(HTTP_STATUS.OK)
		.execute();
}

describe('Community creation staff only policy', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		await getInstanceConfigRepository().setInstancePolicyConfig({
			community_creation_staff_only: false,
			single_community_enabled: false,
		});
	});

	afterAll(async () => {
		await harness.shutdown();
	});

	it('allows non-staff users to create communities when staff-only is disabled', async () => {
		const account = await createTestAccount(harness);
		const response = await createBuilder<GuildResponse>(harness, account.token)
			.post('/guilds')
			.body({name: 'Everyone Guild'})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(response.name).toBe('Everyone Guild');
	});

	it('rejects non-staff users with 403 MISSING_PERMISSIONS when staff-only is enabled', async () => {
		await getInstanceConfigRepository().setInstancePolicyConfig({
			community_creation_staff_only: true,
		});

		const account = await createTestAccount(harness);
		const error = await createBuilder<{code: string}>(harness, account.token)
			.post('/guilds')
			.body({name: 'Forbidden Guild'})
			.expect(HTTP_STATUS.FORBIDDEN)
			.execute();

		expect(error.code).toBe(APIErrorCodes.MISSING_PERMISSIONS);
	});

	it('allows staff users to create communities when staff-only is enabled', async () => {
		await getInstanceConfigRepository().setInstancePolicyConfig({
			community_creation_staff_only: true,
		});

		const staffAccount = await createTestAccount(harness);
		await setUserFlags(harness, staffAccount.userId, UserFlags.STAFF);

		const response = await createBuilder<GuildResponse>(harness, staffAccount.token)
			.post('/guilds')
			.body({name: 'Staff Community'})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(response.name).toBe('Staff Community');
	});
});
