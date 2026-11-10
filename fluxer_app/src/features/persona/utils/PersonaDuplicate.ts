// SPDX-License-Identifier: AGPL-3.0-or-later

import {fittingStart, PERSONA_NAME_MAX} from './PersonaNameLength';

/**
 * The name for a copy of the persona called `name`: the name with the first free number, "Lyra (2)",
 * "Lyra (3)"…, shortening the name, between whole characters, where the number would not fit. A copy of
 * a copy counts on from the persona it copied ("Lyra (2)", with a Lyra, gives "Lyra (3)"); any other
 * number in brackets is part of the name ("Lyra (2026)" gives "Lyra (2026) (2)"). Names compare trimmed
 * and ignoring case, and the copy never takes the name itself (tyne-chat/tyne#599). The mobile app's
 * `duplicatePersonaName` repeats this rule.
 */
export function duplicatePersonaName(name: string, takenNames: Iterable<string>): string {
	const trimmed = name.trim();
	const taken = new Set(Array.from(takenNames, (n) => n.trim().toLowerCase()));
	taken.add(trimmed.toLowerCase());
	const numbered = /^(.*\S)\s+\(\d+\)$/u.exec(trimmed);
	const base = numbered && taken.has(numbered[1]!.toLowerCase()) ? numbered[1]! : trimmed;
	for (let n = 2; n < 10000; n++) {
		const suffix = ` (${n})`;
		const candidate = `${fittingStart(base, PERSONA_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
	return trimmed;
}
