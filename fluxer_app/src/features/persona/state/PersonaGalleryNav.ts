// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

interface PersonaGalleryRequest {
	userId: string;
	/** A persona to open in the gallery, or none for the gallery itself. */
	personaId: string | null;
	/** Open it expanded, over the profile's header: the persona's own profile (tyne-chat/tyne#702). */
	expanded: boolean;
}

/** The persona the gallery is asked to open, and whether expanded. */
export interface PersonaGalleryOpenRequest {
	personaId: string;
	expanded: boolean;
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

	request(userId: string, personaId: string | null = null, {expanded = false}: {expanded?: boolean} = {}): void {
		this.tabRequest = {userId, personaId, expanded};
		this.personaRequest = personaId ? {userId, personaId, expanded} : null;
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
		return this.takePersonaOpen(userId)?.personaId ?? null;
	}

	/** Takes the persona request with how to show it. */
	takePersonaOpen(userId: string): PersonaGalleryOpenRequest | null {
		const request = this.personaRequest;
		if (request?.userId !== userId || !request.personaId) return null;
		this.personaRequest = null;
		return {personaId: request.personaId, expanded: request.expanded};
	}
}

export const PersonaGalleryNav = new PersonaGalleryNavStore();
