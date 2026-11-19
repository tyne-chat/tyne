// SPDX-License-Identifier: AGPL-3.0-or-later

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {HttpError} from '@app/features/platform/types/EndpointError';
import type {RestResponse} from '@app/features/platform/types/TransportTypes';
import {Logger} from '@app/features/platform/utils/AppLogger';
import type {
	PersonaGroupListResponse,
	PersonaGroupResponse,
} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';
import {PersonaGroups} from '../state/PersonaGroups';
import {PersonaRequestError, sendPersonaRequest} from './PersonaCommands';

// The account's persona groups (tyne-chat/tyne#829). Every change also comes back as
// USER_PERSONA_GROUPS_UPDATE, the whole list; the replies are applied at once so the screen does
// not wait for it. A reply that arrives after the groups were reset (`PersonaGroups.epoch`: account
// switch, sign-out, a READY with a new session) is dropped.

const logger = new Logger('PersonaGroupCommands');

let inFlight: {epoch: number; request: Promise<void>} | null = null;

/**
 * Loads the groups: after READY, and when the settings list or the persona editor opens without
 * them. Calls while one is on its way share it, unless the groups were reset since it started. A
 * failure leaves the list as it is and is not retried here: the next READY or opening asks again.
 */
export function fetchPersonaGroups(): Promise<void> {
	const epoch = PersonaGroups.epoch;
	if (inFlight && inFlight.epoch === epoch) return inFlight.request;
	const entry: {epoch: number; request: Promise<void>} = {epoch, request: Promise.resolve()};
	entry.request = (async () => {
		try {
			const res = await http.get<PersonaGroupListResponse>(ForkEndpoints.USER_PERSONA_GROUPS);
			if (PersonaGroups.epoch !== epoch) return;
			if (res.ok && Array.isArray(res.body)) PersonaGroups.setGroups(res.body);
			else logger.warn(`Failed to fetch persona groups: status ${res.status}`);
		} catch (err) {
			logger.error('Error fetching persona groups', err);
		} finally {
			if (inFlight === entry) inFlight = null;
		}
	})();
	inFlight = entry;
	return entry.request;
}

export async function createPersonaGroup(
	name: string,
	personaIds: ReadonlyArray<string> = [],
): Promise<PersonaGroupResponse> {
	const epoch = PersonaGroups.epoch;
	const res = await sendPersonaRequest(
		() =>
			http.post<PersonaGroupResponse>(ForkEndpoints.USER_PERSONA_GROUPS, {
				body: personaIds.length > 0 ? {name, persona_ids: personaIds} : {name},
			}),
		'Failed to create the group',
	);
	if (PersonaGroups.epoch === epoch) PersonaGroups.upsertGroup(res.body);
	return res.body;
}

export async function renamePersonaGroup(groupId: string, name: string): Promise<void> {
	// The same name again changes nothing, so it sends nothing.
	if (PersonaGroups.getGroup(groupId)?.name === name) return;
	const epoch = PersonaGroups.epoch;
	const res = await sendPersonaRequest(
		() => http.patch<PersonaGroupResponse>(ForkEndpoints.USER_PERSONA_GROUP(groupId), {body: {name}}),
		'Failed to rename the group',
	);
	if (PersonaGroups.epoch === epoch) PersonaGroups.upsertGroup(res.body);
}

/** Deletes the group alone; its personas stay. A group that is already gone counts as deleted. */
export async function deletePersonaGroup(groupId: string): Promise<void> {
	const epoch = PersonaGroups.epoch;
	// 204 with no body, so not through sendPersonaRequest.
	let res: RestResponse;
	try {
		res = await http.delete(ForkEndpoints.USER_PERSONA_GROUP(groupId));
	} catch (err) {
		if (!(err instanceof HttpError)) throw err;
		if (err.status !== 404) throw new PersonaRequestError(err, 'Failed to delete the group');
		res = {ok: false, status: 404, headers: {}, body: null};
	}
	if (!res.ok && res.status !== 404) throw new PersonaRequestError(res, 'Failed to delete the group');
	if (PersonaGroups.epoch === epoch) PersonaGroups.removeGroup(groupId);
}

export interface PersonaGroupMemberChange {
	groupId: string;
	add?: ReadonlyArray<string>;
	remove?: ReadonlyArray<string>;
}

/** Puts personas in groups and takes them out, in one request, whole or not at all. */
export async function changePersonaGroupMembers(changes: ReadonlyArray<PersonaGroupMemberChange>): Promise<void> {
	const effective = changes.filter((c) => (c.add?.length ?? 0) > 0 || (c.remove?.length ?? 0) > 0);
	if (effective.length === 0) return;
	const epoch = PersonaGroups.epoch;
	const res = await sendPersonaRequest(
		() =>
			http.patch<PersonaGroupListResponse>(ForkEndpoints.USER_PERSONA_GROUP_MEMBERS, {
				body: {
					changes: effective.map((c) => ({
						group_id: c.groupId,
						...(c.add && c.add.length > 0 ? {add: c.add} : {}),
						...(c.remove && c.remove.length > 0 ? {remove: c.remove} : {}),
					})),
				},
			}),
		'Failed to change the groups',
	);
	if (PersonaGroups.epoch === epoch) PersonaGroups.setGroups(res.body);
}
