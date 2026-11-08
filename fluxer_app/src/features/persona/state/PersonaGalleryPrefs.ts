// SPDX-License-Identifier: AGPL-3.0-or-later

import {PERSONA_GALLERY_VIEWS, type PersonaGalleryView} from '@app/features/persona/utils/PersonaGalleryItems';
import {makePersistent} from '@app/features/platform/utils/MobXPersistence';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import {makeAutoObservable} from 'mobx';

/**
 * How the Personas tab and sheet show personas (tyne-chat/tyne#189). Kept in this device's storage
 * (`makePersistent`, key `PersonaGallery`), not synced: Chiara chose per device on 2026-11-07.
 */
class PersonaGalleryPrefsStore {
	view: PersonaGalleryView = 'gallery';

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
		initializeStore(this, () => makePersistent(this, 'PersonaGallery', ['view']));
	}

	get currentView(): PersonaGalleryView {
		return PERSONA_GALLERY_VIEWS.includes(this.view) ? this.view : 'gallery';
	}

	setView(view: PersonaGalleryView): void {
		this.view = view;
	}
}

export const PersonaGalleryPrefs = new PersonaGalleryPrefsStore();
