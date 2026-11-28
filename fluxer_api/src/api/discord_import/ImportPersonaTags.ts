// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: a Discord import gives a persona no tag another of its owner's live personas holds (tyne-chat/tyne#962).
// The importer writes personas through the repository, without PersonaService's one-tag-one-persona rule, and a
// tag on two live personas makes every restore of a deleted persona fail (the end state check of applyImport).
// The tag stays with the persona that has it, as a restore already does; personas this run writes count as they
// are written. Only live personas hold tags: a deleted one gives its tags up on restore if they are taken.

import {getTagKey, normalizeTag} from '@app/api/persona/PersonaTagKeys';
import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

export interface HeldPersona {
	id: string;
	tags: ReadonlyArray<PersonaTag>;
	deleted: boolean;
}

const keyOf = (tag: PersonaTag): string | null => {
	const norm = normalizeTag(tag);
	return norm.prefix || norm.suffix ? getTagKey(norm) : null;
};

export class PersonaTagHolders {
	private readonly byUser = new Map<string, Map<string, Set<string>>>();

	constructor(private readonly load: (userId: string) => Promise<ReadonlyArray<HeldPersona>>) {}

	private async holders(userId: string): Promise<Map<string, Set<string>>> {
		let held = this.byUser.get(userId);
		if (!held) {
			held = new Map();
			for (const persona of await this.load(userId)) {
				if (!persona.deleted) held.set(persona.id, new Set(persona.tags.flatMap((tag) => keyOf(tag) ?? [])));
			}
			this.byUser.set(userId, held);
		}
		return held;
	}

	/** The tags `personaId` may have: those no other live persona of `userId` holds, and the ones it must give up. */
	async free(
		userId: string,
		personaId: string,
		tags: ReadonlyArray<PersonaTag>,
	): Promise<{kept: Array<PersonaTag>; dropped: Array<PersonaTag>}> {
		const held = await this.holders(userId);
		const taken = new Set<string>();
		for (const [id, keys] of held) if (id !== personaId) for (const key of keys) taken.add(key);
		const kept: Array<PersonaTag> = [];
		const dropped: Array<PersonaTag> = [];
		for (const tag of tags) {
			const key = keyOf(tag);
			(key && taken.has(key) ? dropped : kept).push(tag);
		}
		return {kept, dropped};
	}

	/** What `personaId` holds once written: its tags when live, nothing when deleted. */
	async record(userId: string, personaId: string, tags: ReadonlyArray<PersonaTag>, deleted: boolean): Promise<void> {
		const held = await this.holders(userId);
		if (deleted) held.delete(personaId);
		else held.set(personaId, new Set(tags.flatMap((tag) => keyOf(tag) ?? [])));
	}
}
