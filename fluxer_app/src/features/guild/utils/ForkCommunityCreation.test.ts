// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {LimitConfigSnapshot} from '@fluxer/limits/src/LimitTypes';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const runtime = vi.hoisted(() => ({
	features: {self_hosted: true},
	community: {guild_create_access: false},
	snapshot: null as {limits: unknown} | null,
}));
const users = vi.hoisted(() => ({currentUser: null as unknown}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		get features() {
			return runtime.features;
		},
		get community() {
			return runtime.community;
		},
		getSnapshotOrNull: () => runtime.snapshot,
	},
}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {
		get currentUser() {
			return users.currentUser;
		},
	},
}));

const {User} = await import('@app/features/user/models/User');
const {canCreateCommunities, hasCommunityCreationGrant} = await import(
	'@app/features/guild/utils/ForkCommunityCreation'
);

const GRANT_TO_CREATORS: LimitConfigSnapshot = {
	traitDefinitions: ['community_creator'],
	rules: [{id: 'creators', filters: {traits: ['community_creator']}, limits: {feature_guild_create: 1}}],
};

const account = (fields: {acls?: Array<string>; traits?: Array<string>}) =>
	new User({
		id: '1500000000000000001',
		username: 'member',
		discriminator: '0001',
		global_name: null,
		avatar: null,
		avatar_color: null,
		flags: 0,
		...fields,
	});

describe('community creation for the signed-in account', () => {
	beforeEach(() => {
		runtime.features = {self_hosted: true};
		runtime.community = {guild_create_access: false};
		runtime.snapshot = {limits: GRANT_TO_CREATORS};
		users.currentUser = account({});
	});

	it("follows the instance's policy", () => {
		expect(canCreateCommunities()).toBe(false);
		runtime.community = {guild_create_access: true};
		expect(canCreateCommunities()).toBe(true);
		runtime.community = {guild_create_access: false};
		runtime.features = {self_hosted: false};
		expect(canCreateCommunities()).toBe(true);
	});

	it("reads the account's ACLs and traits from its private user object", () => {
		users.currentUser = account({acls: ['*']});
		expect(canCreateCommunities()).toBe(true);
		users.currentUser = account({traits: ['community_creator']});
		expect(canCreateCommunities()).toBe(true);
	});

	it('keeps the ACLs across an update that leaves them out, and drops them when they are taken away', () => {
		const admin = account({acls: ['*']});
		users.currentUser = admin.withUpdates({global_name: 'Admin'});
		expect(canCreateCommunities()).toBe(true);
		users.currentUser = admin.withUpdates({acls: []});
		expect(canCreateCommunities()).toBe(false);
	});

	it('refuses while signed out or before the limit rules are known', () => {
		users.currentUser = null;
		expect(canCreateCommunities()).toBe(false);
		users.currentUser = account({traits: ['community_creator']});
		runtime.snapshot = null;
		expect(canCreateCommunities()).toBe(false);
	});

	it('finds a grant only on the accounts the restriction lets through, also while the policy is open', () => {
		runtime.community = {guild_create_access: true};
		expect(canCreateCommunities()).toBe(true);
		expect(hasCommunityCreationGrant()).toBe(false);
		users.currentUser = account({acls: ['*']});
		expect(hasCommunityCreationGrant()).toBe(true);
		users.currentUser = account({traits: ['community_creator']});
		expect(hasCommunityCreationGrant()).toBe(true);
		users.currentUser = null;
		expect(hasCommunityCreationGrant()).toBe(false);
	});
});
