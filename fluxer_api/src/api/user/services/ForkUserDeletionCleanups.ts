// SPDX-License-Identifier: AGPL-3.0-or-later

import type {UserID} from '@app/api/BrandedTypes';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';
import {forgetPersonaChannelStatesOfUser} from '@app/api/persona/PersonaChannelStateStore';
import {forgetPersonaImageSourcesOfUser} from '@app/api/persona/PersonaImageSourceStore';
import {forgetThreadOwnerPersonasOfUser} from '@app/api/persona/ThreadOwnerPersonaStore';

// Fork: the fork's steps in processUserDeletion's last Promise.all, which spreads them in at the end.
export function forkUserDeletionCleanups(
	userId: UserID,
	personaRepository: IPersonaRepository,
): Array<Promise<unknown>> {
	return [
		personaRepository.hardDeleteAllByUserId(userId),
		personaRepository.deleteSettings(userId),
		forgetThreadOwnerPersonasOfUser(userId),
		forgetPersonaChannelStatesOfUser(userId),
		forgetPersonaImageSourcesOfUser(userId),
	];
}
