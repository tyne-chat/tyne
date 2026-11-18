// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How typed text finds a persona by name (tyne-chat/tyne#707). Besides its name, a persona may have
 * aliases: other names to find it by, for a name written in letters a keyboard does not easily type
 * (`SΛTVRN` found by "saturn") or names that are not what it is called. Aliases are never shown;
 * they only take part in matching, a little below the name itself.
 */

export const PERSONA_ALIAS_MAX_LENGTH = 100;
export const PERSONA_ALIASES_MAX = 10;

const NAME_PREFIX = 1000;
const NAME_WORD = 800;
const NAME_ANYWHERE = 500;
const ALIAS_PREFIX = 900;
const ALIAS_WORD = 700;
const ALIAS_ANYWHERE = 450;

function textScore(text: string, q: string, prefix: number, word: number, anywhere: number): number {
	const lowered = text.toLowerCase();
	if (lowered.startsWith(q)) return prefix;
	if (lowered.includes(` ${q}`) || lowered.includes(`-${q}`) || lowered.includes(`_${q}`)) return word;
	if (lowered.includes(q)) return anywhere;
	return -1;
}

/**
 * The score of [query] against a persona's name, else its best alias: higher is a better match, -1
 * when none contains it. The query is trimmed and compared without case; an empty one scores 0.
 */
export function personaNameMatchScore(
	name: string,
	aliases: ReadonlyArray<string> | null | undefined,
	query: string,
): number {
	const q = query.trim().toLowerCase();
	if (!q) return 0;
	const byName = textScore(name, q, NAME_PREFIX, NAME_WORD, NAME_ANYWHERE);
	if (byName >= 0) return byName;
	let best = -1;
	for (const alias of aliases ?? []) {
		best = Math.max(best, textScore(alias, q, ALIAS_PREFIX, ALIAS_WORD, ALIAS_ANYWHERE));
	}
	return best;
}

/** Whether [query] is in the persona's name or one of its aliases, without case. An empty query matches. */
export function personaNameMatches(
	name: string,
	aliases: ReadonlyArray<string> | null | undefined,
	query: string,
): boolean {
	return personaNameMatchScore(name, aliases, query) >= 0;
}

/** Whether one of the aliases is exactly [wanted], without case or outer spaces. */
export function personaAliasesInclude(aliases: ReadonlyArray<string> | null | undefined, wanted: string): boolean {
	const w = wanted.trim().toLowerCase();
	if (!w) return false;
	return (aliases ?? []).some((alias) => alias.trim().toLowerCase() === w);
}

/**
 * Aliases as they are stored: trimmed, without blanks or repeats (compared without case), the
 * first spelling kept, at most `PERSONA_ALIASES_MAX`.
 */
export function normalizePersonaAliases(aliases: ReadonlyArray<string> | null | undefined): Array<string> {
	const seen = new Set<string>();
	const out: Array<string> = [];
	for (const raw of aliases ?? []) {
		const alias = raw.trim();
		const key = alias.toLowerCase();
		if (!alias || seen.has(key)) continue;
		seen.add(key);
		out.push(alias);
		if (out.length >= PERSONA_ALIASES_MAX) break;
	}
	return out;
}

/** Aliases read from storage or a file: an array of strings, anything else dropped. */
export function readPersonaAliases(value: unknown): Array<string> {
	if (typeof value === 'string') {
		try {
			return readPersonaAliases(JSON.parse(value));
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];
	return normalizePersonaAliases(
		value.filter((item): item is string => typeof item === 'string').map((s) => s.slice(0, PERSONA_ALIAS_MAX_LENGTH)),
	);
}
