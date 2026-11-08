// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';

/**
 * A tag as Tyne compares it: prefix and suffix trimmed, case kept. Two tags with the same key belong
 * to at most one live persona of an account; `PersonaMatcher` matches messages the same way.
 */
export function normalizeTag(tag: PersonaTag): {prefix: string; suffix: string} {
	return {
		prefix: (tag.prefix ?? '').trim(),
		suffix: (tag.suffix ?? '').trim(),
	};
}

// A JSON pair, so no prefix or suffix can be read as part of the other.
export function getTagKey(tag: {prefix: string; suffix: string}): string {
	return JSON.stringify([tag.prefix, tag.suffix]);
}

export function formatTagDisplay(tag: {prefix: string; suffix: string}): string {
	return `${tag.prefix || ''}text${tag.suffix || ''}`;
}

/** The keys of a list of tags, leaving out empty ones. */
export function tagKeys(tags: ReadonlyArray<PersonaTag> | null | undefined): Array<string> {
	const keys: Array<string> = [];
	for (const tag of tags ?? []) {
		const norm = normalizeTag(tag);
		if (norm.prefix || norm.suffix) keys.push(getTagKey(norm));
	}
	return keys;
}
