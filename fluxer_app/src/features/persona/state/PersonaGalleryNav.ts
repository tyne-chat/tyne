// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

interface PersonaGalleryRequest {
	userId: string;
	/** A persona to open in the gallery, or none for the gallery itself. */
	personaId: string | null;
}

/**
 * Asks the profile window to show an account's Personas tab, and optionally one persona in it: the
 * Personas pill and a persona's popout make the request, then open the full profile; the profile
 * window takes the tab part, the gallery takes the persona (tyne-chat/tyne#189).
 */
class PersonaGalleryNavStore {
	private tabRequest: PersonaGalleryRequest | null = null;
	private personaRequest: PersonaGalleryRequest | null = null;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	request(userId: string, personaId: string | null = null): void {
		this.tabRequest = {userId, personaId};
		this.personaRequest = personaId ? {userId, personaId} : null;
	}

	hasTabRequest(userId: string): boolean {
		return this.tabRequest?.userId === userId;
	}

	takeTabRequest(userId: string): boolean {
		if (this.tabRequest?.userId !== userId) return false;
		this.tabRequest = null;
		return true;
	}

	pendingPersona(userId: string): string | null {
		return this.personaRequest?.userId === userId ? this.personaRequest.personaId : null;
	}

	takePersonaRequest(userId: string): string | null {
		const personaId = this.pendingPersona(userId);
		if (personaId) this.personaRequest = null;
		return personaId;
	}
}

export const PersonaGalleryNav = new PersonaGalleryNavStore();
