// SPDX-License-Identifier: AGPL-3.0-or-later

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount, setUserACLs} from '@app/api/auth/tests/AuthTestUtils';
import type {ApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import type {InstanceDiscoveryResponse} from '@fluxer/instance_bootstrap/src/Types';
import type {InstanceConfigResponse} from '@fluxer/schema/src/domains/admin/AdminSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('instance policy server list buttons', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
	});

	afterAll(async () => {
		await harness.shutdown();
	});

	const createAdmin = async (): Promise<TestAccount> =>
		await setUserACLs(harness, await createTestAccount(harness), [
			AdminACLs.AUTHENTICATE,
			AdminACLs.INSTANCE_CONFIG_VIEW,
			AdminACLs.INSTANCE_CONFIG_UPDATE,
		]);

	it('defaults all 5 server list buttons to true', async () => {
		const admin = await createAdmin();
		const config = await createBuilder<InstanceConfigResponse>(harness, admin.token)
			.get('/admin/instance/config')
			.execute();

		expect(config.policy.server_list_buttons).toEqual({
			favorites: true,
			explore: true,
			create_join: true,
			download: true,
			help: true,
		});

		const discovery = await createBuilder<InstanceDiscoveryResponse>(harness, '').get('/.well-known/fluxer').execute();

		expect(discovery.community.server_list_buttons).toEqual({
			favorites: true,
			explore: true,
			create_join: true,
			download: true,
			help: true,
		});
	});

	it('updates server list buttons via admin PATCH and reflects in discovery', async () => {
		const admin = await createAdmin();

		const updated = await createBuilder<InstanceConfigResponse>(harness, admin.token)
			.patch('/admin/instance/config')
			.body({
				policy: {
					server_list_buttons: {
						explore: false,
						download: false,
						help: false,
					},
				},
			})
			.execute();

		expect(updated.policy.server_list_buttons).toEqual({
			favorites: true,
			explore: false,
			create_join: true,
			download: false,
			help: false,
		});

		const discovery = await createBuilder<InstanceDiscoveryResponse>(harness, '').get('/.well-known/fluxer').execute();

		expect(discovery.community.server_list_buttons).toEqual({
			favorites: true,
			explore: false,
			create_join: true,
			download: false,
			help: false,
		});
	});
});
