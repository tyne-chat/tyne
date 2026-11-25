// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaBlockResponse} from '@fluxer/schema/src/domains/persona/PersonaBlockSchemas';
import {makeAutoObservable} from 'mobx';

function blockKey(userId: string, personaId: string): string {
	return `${userId}:${personaId}`;
}

/**
 * The personas this account has blocked (tyne-chat/tyne#921), as the server last sent them. A
 * blocked persona's messages are treated as a blocked account's are (collapsed, or hidden with
 * "Hide messages from blocked users"); nothing else about the persona changes. Emptied with the
 * personas (`PersonaStore.reset`).
 */
class PersonaBlocksStore {
	blocks: ReadonlyArray<PersonaBlockResponse> = [];
	keys: ReadonlySet<string> = new Set();
	/** Whether the list came from the server since the last reset. */
	loaded = false;
	/** Counts the resets: a reply to a request made before the last one is dropped. */
	epoch = 0;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	setBlocks(blocks: ReadonlyArray<PersonaBlockResponse>): void {
		this.blocks = blocks;
		this.keys = new Set(blocks.map((block) => blockKey(block.user_id, block.persona_id)));
		this.loaded = true;
	}

	reset(): void {
		this.blocks = [];
		this.keys = new Set();
		this.loaded = false;
		this.epoch += 1;
	}

	isBlocked(userId: string, personaId: string | null | undefined): boolean {
		return personaId != null && this.keys.has(blockKey(userId, personaId));
	}
}

export const PersonaBlocks = new PersonaBlocksStore();
