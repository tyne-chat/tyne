// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ProxyTagLike {
	prefix?: string | null;
	suffix?: string | null;
}

export interface PersonaLike {
	id: string;
	name: string;
	avatar_url?: string | null;
	proxy_tags?: ReadonlyArray<ProxyTagLike> | null;
	system_name?: string | null;
	pronouns?: string | null;
	color?: number | null;
	auto_proxy_disabled?: boolean | null;
	bio?: string | null;
}

export interface MatchResult {
	matched: boolean;
	persona?: PersonaLike;
	strippedContent: string;
	wasEscaped?: boolean;
	clearedLatch?: boolean;
}

export function matchProxy(
	text: string,
	personas: ReadonlyArray<PersonaLike>,
	activeLatchedPersonaId?: string | null,
): MatchResult {
	const latchedPersona = activeLatchedPersonaId
		? personas.find((p) => p.id === activeLatchedPersonaId && !p.auto_proxy_disabled)
		: undefined;

	// Only process escape slashes and unlatch commands if a subprofile is currently latched
	if (latchedPersona) {
		// Check unlatch trigger: "\\" clears active latch
		if (text.trim() === '\\\\') {
			return {
				matched: false,
				strippedContent: '',
				clearedLatch: true,
				wasEscaped: true,
			};
		}

		// Check double backslash with message: "\\ [message]" sends as root account and CLEARS latch
		if (text.startsWith('\\\\')) {
			const rawRest = text.slice(2);
			const strippedContent = rawRest.startsWith(' ') ? rawRest.slice(1) : rawRest;
			return {
				matched: false,
				strippedContent,
				clearedLatch: true,
				wasEscaped: true,
			};
		}

		// Check single backslash: "\ [message]" sends as root account and PRESERVES latch
		if (text.startsWith('\\')) {
			const rawRest = text.slice(1);
			const strippedContent = rawRest.startsWith(' ') ? rawRest.slice(1) : rawRest;
			return {
				matched: false,
				strippedContent,
				wasEscaped: true,
			};
		}
	}

	// Collect candidate matches across all enabled personas
	interface CandidateMatch {
		persona: PersonaLike;
		prefixLen: number;
		suffixLen: number;
		totalLen: number;
		innerContent: string;
	}

	const candidates: Array<CandidateMatch> = [];

	for (const persona of personas) {
		if (persona.auto_proxy_disabled) continue;
		if (!persona.proxy_tags || persona.proxy_tags.length === 0) continue;

		for (const tag of persona.proxy_tags) {
			const prefix = tag.prefix ?? '';
			const suffix = tag.suffix ?? '';
			if (!prefix && !suffix) continue;

			if (text.startsWith(prefix) && text.endsWith(suffix)) {
				const innerStart = prefix.length;
				const innerEnd = text.length - suffix.length;
				if (innerEnd > innerStart) {
					const inner = text.slice(innerStart, innerEnd).trim();
					if (inner.length > 0) {
						candidates.push({
							persona,
							prefixLen: prefix.length,
							suffixLen: suffix.length,
							totalLen: prefix.length + suffix.length,
							innerContent: inner,
						});
					}
				}
			}
		}
	}

	if (candidates.length > 0) {
		// Longest match wins
		candidates.sort((a, b) => b.totalLen - a.totalLen);
		const best = candidates[0];
		return {
			matched: true,
			persona: best.persona,
			strippedContent: best.innerContent,
		};
	}

	// Fallback to active latched persona if one is set
	if (latchedPersona) {
		return {
			matched: true,
			persona: latchedPersona,
			strippedContent: text,
		};
	}

	return {
		matched: false,
		strippedContent: text,
	};
}
