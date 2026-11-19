// SPDX-License-Identifier: AGPL-3.0-or-later

import {makePersistent} from '@app/features/platform/utils/MobXPersistence';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import {makeAutoObservable} from 'mobx';

/** The fold of the section for personas in no group. */
export const NOT_IN_A_GROUP_FOLD_ID = 'none';

/**
 * Which persona groups are folded in the persona settings list (tyne-chat/tyne#829). Kept in this
 * device's storage (`makePersistent`, key `PersonaGroupFolds`), not synced: Chiara asked for local
 * state on 2026-11-18. Keyed by account and group, so two accounts on one device keep their own.
 * Only folded groups are stored.
 */
class PersonaGroupFoldsStore {
	folded: Record<string, boolean> = {};

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
		initializeStore(this, () => makePersistent(this, 'PersonaGroupFolds', ['folded']));
	}

	isFolded(accountId: string | null | undefined, groupId: string): boolean {
		return accountId != null && this.folded[foldKey(accountId, groupId)] === true;
	}

	setFolded(accountId: string | null | undefined, groupId: string, folded: boolean): void {
		if (accountId == null) return;
		const next = {...this.folded};
		if (folded) next[foldKey(accountId, groupId)] = true;
		else delete next[foldKey(accountId, groupId)];
		this.folded = next;
	}

	toggle(accountId: string | null | undefined, groupId: string): void {
		this.setFolded(accountId, groupId, !this.isFolded(accountId, groupId));
	}
}

function foldKey(accountId: string, groupId: string): string {
	return `${accountId}:${groupId}`;
}

export const PersonaGroupFolds = new PersonaGroupFoldsStore();
