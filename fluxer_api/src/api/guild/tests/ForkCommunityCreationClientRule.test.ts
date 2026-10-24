// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the web app hides community creation from an account by evaluating upstream's rule itself
// (packages/limits/src/ForkCommunityCreation.ts), from what the API serves the client: the private
// user object (ACLs, traits) and the instance discovery document (self_hosted, the community policy,
// the limit rules). Each case here feeds the client's rule exactly that and checks that it agrees
// with what POST /guilds does. When upstream changes its rule, or stops serving one of the inputs,
// this test fails and the client's copy needs the same change.

import type {TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createTestAccount, setUserACLs} from '@app/api/auth/tests/AuthTestUtils';
import {getConfig} from '@app/api/Config';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder, createBuilderWithoutAuth} from '@app/api/test/TestRequestBuilder';
import {fetchUserMe} from '@app/api/user/tests/UserTestUtils';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {canCreateCommunities} from '@fluxer/limits/src/ForkCommunityCreation';
import {expandWireFormat} from '@fluxer/limits/src/LimitDiffer';
import type {LimitConfigSnapshot} from '@fluxer/limits/src/LimitTypes';
import type {WellKnownFluxerResponse} from '@fluxer/schema/src/domains/instance/InstanceSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const COMMUNITY_CREATOR_TRAIT = 'community_creator';

describe("the client's community creation rule agrees with the API", () => {
	let harness: ApiTestHarness;
	let admin: TestAccount;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		admin = await setUserACLs(harness, await createTestAccount(harness), [
			AdminACLs.AUTHENTICATE,
			AdminACLs.INSTANCE_CONFIG_VIEW,
			AdminACLs.INSTANCE_CONFIG_UPDATE,
			AdminACLs.INSTANCE_LIMIT_CONFIG_VIEW,
			AdminACLs.INSTANCE_LIMIT_CONFIG_UPDATE,
			AdminACLs.USER_UPDATE_TRAITS,
		]);
	});

	afterAll(async () => {
		await harness.shutdown();
	});

	const withSelfHosted = async <T>(selfHosted: boolean, run: () => Promise<T>): Promise<T> => {
		const config = getConfig();
		const original = config.instance.selfHosted;
		config.instance.selfHosted = selfHosted;
		try {
			return await run();
		} finally {
			config.instance.selfHosted = original;
		}
	};

	const createMember = async (): Promise<TestAccount> =>
		await setUserACLs(harness, await createTestAccount(harness), []);

	const restrictCommunityCreation = async (): Promise<void> => {
		await createBuilder(harness, admin.token)
			.patch('/admin/instance/config')
			.body({policy: {guild_create_access: false}})
			.expect(HTTP_STATUS.OK)
			.execute();
	};

	const grantCommunityCreationToTrait = async (): Promise<void> => {
		const current = await createBuilder<{limit_config: LimitConfigSnapshot}>(harness, admin.token)
			.get('/admin/limit-config')
			.expect(HTTP_STATUS.OK)
			.execute();
		await createBuilder(harness, admin.token)
			.put('/admin/limit-config')
			.body({
				limit_config: {
					traitDefinitions: [...current.limit_config.traitDefinitions, COMMUNITY_CREATOR_TRAIT],
					rules: [
						...current.limit_config.rules,
						{id: 'community_creators', filters: {traits: [COMMUNITY_CREATOR_TRAIT]}, limits: {feature_guild_create: 1}},
					],
				},
			})
			.expect(HTTP_STATUS.OK)
			.execute();
	};

	const giveTrait = async (account: TestAccount): Promise<void> => {
		await createBuilder(harness, admin.token)
			.put(`/admin/users/${account.userId}/traits`)
			.body({traits: [COMMUNITY_CREATOR_TRAIT]})
			.expect(HTTP_STATUS.OK)
			.execute();
	};

	// What the web app decides from what the API serves this account.
	const clientAllows = async (account: TestAccount): Promise<boolean> => {
		const {json: me} = await fetchUserMe(harness, account.token);
		const discovery = await createBuilderWithoutAuth<WellKnownFluxerResponse>(harness)
			.get('/.well-known/fluxer')
			.execute();
		return canCreateCommunities({
			selfHosted: discovery.features.self_hosted,
			guildCreateAccess: discovery.community.guild_create_access,
			acls: me.acls,
			traits: me.traits,
			limits: expandWireFormat(discovery.limits),
		});
	};

	const apiAllows = async (account: TestAccount): Promise<boolean> => {
		const {response} = await createBuilder(harness, account.token)
			.post('/guilds')
			.body({name: 'Client rule community'})
			.executeRaw();
		expect([HTTP_STATUS.OK, HTTP_STATUS.FORBIDDEN]).toContain(response.status);
		return response.status === HTTP_STATUS.OK;
	};

	const expectAgreement = async (account: TestAccount, expected: boolean): Promise<void> => {
		expect(await clientAllows(account)).toBe(expected);
		expect(await apiAllows(account)).toBe(expected);
	};

	it('lets a member create communities while the policy is open', async () => {
		const member = await createMember();
		await withSelfHosted(true, () => expectAgreement(member, true));
	});

	it('refuses a member without a grant once a self-hosted instance restricts it', async () => {
		await restrictCommunityCreation();
		const member = await createMember();
		await withSelfHosted(true, () => expectAgreement(member, false));
	});

	it('ignores the restriction on an instance that is not self-hosted', async () => {
		await restrictCommunityCreation();
		const member = await createMember();
		await withSelfHosted(false, () => expectAgreement(member, true));
	});

	it('lets an admin with the wildcard ACL create communities while it is restricted', async () => {
		await restrictCommunityCreation();
		const wildcard = await setUserACLs(harness, await createTestAccount(harness), [AdminACLs.WILDCARD]);
		await withSelfHosted(true, () => expectAgreement(wildcard, true));
	});

	it('follows a limit rule that grants community creation to a trait', async () => {
		await restrictCommunityCreation();
		await grantCommunityCreationToTrait();
		const member = await createMember();
		await withSelfHosted(true, () => expectAgreement(member, false));
		await giveTrait(member);
		await withSelfHosted(true, () => expectAgreement(member, true));
	});
});
