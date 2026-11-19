// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaGroupResponse} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';
import {makeAutoObservable} from 'mobx';

/**
 * The account's persona groups (tyne-chat/tyne#829), as the server last sent them: in the order they
 * were made, each with its personas in the order they were added. A deleted persona stays listed, so
 * that restoring it puts it back; everything that shows a group shows only live personas. Only this
 * account's sessions see its groups. Emptied with the personas (`PersonaStore.reset`).
 */
class PersonaGroupsStore {
	groups: ReadonlyArray<PersonaGroupResponse> = [];
	/** Whether the list came from the server since the last reset. */
	loaded = false;
	/**
	 * Counts the resets (account switch, sign-out, a READY with a new session): a reply to a request
	 * made before the last one belongs to another account or session and is dropped.
	 */
	epoch = 0;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	setGroups(groups: ReadonlyArray<PersonaGroupResponse>): void {
		this.groups = groups;
		this.loaded = true;
	}

	/** A group the server returned: replaces the one with its id, or comes last, as a new one does. */
	upsertGroup(group: PersonaGroupResponse): void {
		const index = this.groups.findIndex((g) => g.id === group.id);
		this.groups = index < 0 ? [...this.groups, group] : this.groups.map((g, i) => (i === index ? group : g));
	}

	removeGroup(groupId: string): void {
		this.groups = this.groups.filter((g) => g.id !== groupId);
	}

	reset(): void {
		this.groups = [];
		this.loaded = false;
		this.epoch += 1;
	}

	getGroup(groupId: string): PersonaGroupResponse | null {
		return this.groups.find((g) => g.id === groupId) ?? null;
	}

	/** The ids of the groups a persona is in, in the groups' order. */
	groupIdsOf(personaId: string): Array<string> {
		return this.groups.filter((g) => g.persona_ids.includes(personaId)).map((g) => g.id);
	}
}

export const PersonaGroups = new PersonaGroupsStore();
