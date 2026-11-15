// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: the three-way comparison of the Discord history import (tyne-chat/tyne#657). When an import
// runs again, every object an earlier import wrote is compared in three versions: what the import
// wrote then (base), what Tyne holds now (current), and what the new plan says (next). A value nobody
// changed since takes the plan's; a value someone changed on Tyne stays theirs.

/** A stable string for comparing stored values with planned ones: ids and dates as strings, sets
 * sorted, object keys sorted, and null, undefined and empty lists all the same "nothing". */
export function canonical(value: unknown): string {
	return JSON.stringify(normalise(value)) ?? 'null';
}

function normalise(value: unknown): unknown {
	if (value === undefined || value === null) return null;
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Set) {
		const items = [...value].map(normalise);
		return items.length ? items.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) : null;
	}
	if (Array.isArray(value)) return value.length ? value.map(normalise) : null;
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			const item = normalise((value as Record<string, unknown>)[key]);
			if (item !== null) out[key] = item;
		}
		return out;
	}
	return value;
}

export function same(a: unknown, b: unknown): boolean {
	return canonical(a) === canonical(b);
}

export interface FieldMerge<T> {
	/** The fields to set to the plan's value. */
	patch: Partial<T>;
	/** Fields the plan changes but someone changed on Tyne first: theirs is kept. */
	kept: Array<keyof T & string>;
}

export function mergeFields<T extends object>(
	base: T,
	current: T,
	next: T,
	fields: ReadonlyArray<keyof T & string>,
): FieldMerge<T> {
	const patch: Partial<T> = {};
	const kept: Array<keyof T & string> = [];
	for (const field of fields) {
		if (same(current[field], next[field])) continue;
		if (same(current[field], base[field])) patch[field] = next[field];
		else kept.push(field);
	}
	return {patch, kept};
}

/** Whether any of `fields` differs between what the import wrote and what is there now. */
export function changedSince<T extends object>(base: T, current: T, fields: ReadonlyArray<keyof T & string>): boolean {
	return fields.some((field) => !same(base[field], current[field]));
}

/** Set members (reactions, say) to add and remove: the plan's additions that are not there yet, and
 * the plan's removals that are still there. One someone added on Tyne stays, and one someone
 * removed is not brought back. */
export function mergeSets(
	base: ReadonlySet<string>,
	current: ReadonlySet<string>,
	next: ReadonlySet<string>,
): {add: Array<string>; remove: Array<string>} {
	return {
		add: [...next].filter((key) => !base.has(key) && !current.has(key)),
		remove: [...base].filter((key) => !next.has(key) && current.has(key)),
	};
}
