// SPDX-License-Identifier: AGPL-3.0-or-later

import type {User} from '@app/features/user/models/User';
import {makeAutoObservable} from 'mobx';

/** The Personas sheet on phones (tyne-chat/tyne#189): whose personas it shows, if it is open. */
class PersonaGallerySheetStateStore {
	user: User | null = null;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	get isOpen(): boolean {
		return this.user !== null;
	}

	open(user: User): void {
		this.user = user;
	}

	close(): void {
		this.user = null;
	}
}

export const PersonaGallerySheetState = new PersonaGallerySheetStateStore();
