// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the persona an account has selected in each channel, for people who have their persona
// remembered per channel instead of one for everywhere (`active_persona_scope: 'channel'`).
//
// A row means "this persona is selected in this channel". No row means the channel is used as the
// account itself, which is also where every channel starts. The rows are one partition per
// account, so a client loads them in one read and deleting an account removes them in one write.
//
// Rows for channels that were deleted are left behind: they are small, nothing reads them, and
// they go with the account.

import type {ChannelID, PersonaID, UserID} from '@app/api/BrandedTypes';
import {deleteOneOrMany, fetchMany, upsertOne} from '@app/api/database/CassandraQueryExecution';
import type {PersonaChannelStateRow} from '@app/api/database/types/PersonaTypes';
import {PersonaChannelStates} from '@app/api/Tables';

const FETCH_BY_USER = PersonaChannelStates.select({where: PersonaChannelStates.where.eq('user_id')});

export async function loadPersonaChannelStates(userId: UserID): Promise<Array<PersonaChannelStateRow>> {
	return fetchMany<PersonaChannelStateRow>(FETCH_BY_USER.bind({user_id: userId}));
}

export async function storePersonaChannelState(
	userId: UserID,
	channelId: ChannelID,
	personaId: PersonaID,
): Promise<void> {
	await upsertOne(
		PersonaChannelStates.upsertAll({
			user_id: userId,
			channel_id: channelId,
			persona_id: personaId,
			updated_at: new Date(),
		}),
	);
}

export async function forgetPersonaChannelState(userId: UserID, channelId: ChannelID): Promise<void> {
	await deleteOneOrMany(PersonaChannelStates.deleteByPk({user_id: userId, channel_id: channelId}));
}

/** Clears a persona from every channel it is selected in. Returns those channels. */
export async function forgetPersonaChannelStatesOfPersona(
	userId: UserID,
	personaId: PersonaID,
): Promise<Array<ChannelID>> {
	const rows = await loadPersonaChannelStates(userId);
	const channelIds = rows
		.filter((row) => row.persona_id.toString() === personaId.toString())
		.map((row) => row.channel_id);
	for (const channelId of channelIds) {
		await forgetPersonaChannelState(userId, channelId);
	}
	return channelIds;
}

export async function forgetPersonaChannelStatesOfUser(userId: UserID): Promise<void> {
	await deleteOneOrMany(PersonaChannelStates.deletePartition({user_id: userId}));
}
