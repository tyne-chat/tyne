// SPDX-License-Identifier: AGPL-3.0-or-later

import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {
	type CommunityCreationInputs,
	canCreateCommunities,
	hasCommunityCreationGrant,
} from '@fluxer/limits/src/ForkCommunityCreation';
import type {LimitConfigSnapshot} from '@fluxer/limits/src/LimitTypes';
import {describe, expect, it} from 'vitest';

const GRANT_TO_CREATORS: LimitConfigSnapshot = {
	traitDefinitions: ['community_creator'],
	rules: [
		{id: 'default', limits: {}},
		{id: 'creators', filters: {traits: ['community_creator']}, limits: {feature_guild_create: 1}},
	],
};

const restricted = (overrides: Partial<CommunityCreationInputs> = {}): CommunityCreationInputs => ({
	selfHosted: true,
	guildCreateAccess: false,
	acls: [],
	traits: [],
	limits: GRANT_TO_CREATORS,
	...overrides,
});

describe('who may create a community', () => {
	it('is everyone unless a self-hosted instance restricts it', () => {
		expect(canCreateCommunities(restricted({selfHosted: false}))).toBe(true);
		expect(canCreateCommunities(restricted({guildCreateAccess: true}))).toBe(true);
	});

	it('is nobody else without a grant while it is restricted', () => {
		expect(canCreateCommunities(restricted())).toBe(false);
		expect(canCreateCommunities(restricted({acls: [AdminACLs.AUTHENTICATE], traits: ['premium']}))).toBe(false);
	});

	it('includes an admin with the wildcard ACL', () => {
		expect(canCreateCommunities(restricted({acls: [AdminACLs.WILDCARD]}))).toBe(true);
		expect(canCreateCommunities(restricted({acls: [AdminACLs.WILDCARD], limits: null}))).toBe(true);
	});

	it('includes an account whose traits a rule grants community creation', () => {
		expect(canCreateCommunities(restricted({traits: ['community_creator']}))).toBe(true);
		expect(canCreateCommunities(restricted({traits: ['someone_else']}))).toBe(false);
	});

	it('includes everyone when the default rule grants it', () => {
		const everyone: LimitConfigSnapshot = {
			traitDefinitions: [],
			rules: [{id: 'default', limits: {feature_guild_create: 1}}],
		};
		expect(canCreateCommunities(restricted({limits: everyone}))).toBe(true);
	});

	it('ignores a rule that matches a community feature, as the API does', () => {
		const forLargeCommunities: LimitConfigSnapshot = {
			traitDefinitions: [],
			rules: [{id: 'large', filters: {guildFeatures: ['VERY_LARGE_GUILD']}, limits: {feature_guild_create: 1}}],
		};
		expect(canCreateCommunities(restricted({limits: forLargeCommunities}))).toBe(false);
	});

	it('refuses while the limit rules are not known yet', () => {
		expect(canCreateCommunities(restricted({traits: ['community_creator'], limits: null}))).toBe(false);
	});
});

describe('who holds a grant to create communities', () => {
	it('is the accounts the restriction lets through, whatever the policy', () => {
		for (const policy of [restricted(), restricted({guildCreateAccess: true}), restricted({selfHosted: false})]) {
			expect(hasCommunityCreationGrant(policy)).toBe(false);
			expect(hasCommunityCreationGrant({...policy, acls: [AdminACLs.WILDCARD]})).toBe(true);
			expect(hasCommunityCreationGrant({...policy, traits: ['community_creator']})).toBe(true);
		}
	});

	it('is nobody while the limit rules are not known yet, but an admin with the wildcard ACL', () => {
		expect(hasCommunityCreationGrant(restricted({traits: ['community_creator'], limits: null}))).toBe(false);
		expect(hasCommunityCreationGrant(restricted({acls: [AdminACLs.WILDCARD], limits: null}))).toBe(true);
	});
});
