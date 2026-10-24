// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: whether the signed-in account may create a community, by upstream's rule as
// packages/limits/src/ForkCommunityCreation.ts states it, with this instance's policy and limit
// rules and the account's ACLs and traits. AddGuildModal and AddGuildButton hide community creation
// from accounts the API would refuse; GuildsLayout shows the add-community button to accounts with a
// grant when the instance hides it from everyone.

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import Users from '@app/features/user/state/Users';
import {
	canCreateCommunities as communityCreationAllowed,
	hasCommunityCreationGrant as communityCreationGranted,
} from '@fluxer/limits/src/ForkCommunityCreation';

export function canCreateCommunities(): boolean {
	return communityCreationAllowed({
		selfHosted: RuntimeConfig.features.self_hosted,
		guildCreateAccess: RuntimeConfig.community.guild_create_access,
		...accountInputs(),
	});
}

export function hasCommunityCreationGrant(): boolean {
	return communityCreationGranted(accountInputs());
}

function accountInputs() {
	const user = Users.currentUser;
	return {
		acls: user?.acls ?? [],
		traits: user?.traits ?? [],
		limits: RuntimeConfig.getSnapshotOrNull()?.limits ?? null,
	};
}
