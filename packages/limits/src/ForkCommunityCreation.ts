// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: whether an account may create a community, by the rule upstream's API applies when one is
// created (POST /guilds in fluxer_api's GuildBaseController.ts): on a self-hosted instance whose
// policy restricts community creation, only an admin with the wildcard ACL, or an account a limit
// rule grants feature_guild_create, may. Every input is something a client receives: the policy and
// the limit rules from the instance's discovery document, the ACLs and effective traits from the
// account's private user object. The web app uses this to hide community creation from accounts the
// API would refuse; fluxer_api's ForkCommunityCreationClientRule.test.ts feeds it what the API
// serves and checks that it agrees with the API in each case, so a change upstream makes to the
// rule fails there.

import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {resolveLimit} from '@fluxer/limits/src/LimitResolver';
import type {LimitConfigSnapshot} from '@fluxer/limits/src/LimitTypes';

export interface CommunityCreationInputs {
	selfHosted: boolean;
	guildCreateAccess: boolean;
	acls: Iterable<string>;
	traits: Iterable<string>;
	limits: LimitConfigSnapshot | null;
}

export function canCreateCommunities(inputs: CommunityCreationInputs): boolean {
	if (!inputs.selfHosted || inputs.guildCreateAccess) {
		return true;
	}
	return hasCommunityCreationGrant(inputs);
}

// Whether the account may create communities even where the policy restricts it: the accounts the
// restriction lets through. The web app also shows them the add-community button when the instance
// hides it from everyone.
export function hasCommunityCreationGrant(
	inputs: Pick<CommunityCreationInputs, 'acls' | 'traits' | 'limits'>,
): boolean {
	if (new Set(inputs.acls).has(AdminACLs.WILDCARD)) {
		return true;
	}
	if (inputs.limits == null) {
		return false;
	}
	// The API matches the account alone, with no community's features.
	const granted = resolveLimit(
		inputs.limits,
		{traits: new Set(inputs.traits), guildFeatures: new Set()},
		'feature_guild_create',
		{evaluationContext: 'user'},
	);
	return Number.isFinite(granted) && granted > 0;
}
