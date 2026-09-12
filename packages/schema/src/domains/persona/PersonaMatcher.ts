// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PersonaTagLike {
	prefix?: string | null;
	suffix?: string | null;
}

export interface PersonaLike {
	id: string;
	name: string;
	avatar_url?: string | null;
	persona_tags?: ReadonlyArray<PersonaTagLike> | null;
	system_name?: string | null;
	pronouns?: string | null;
	color?: number | null;
	auto_tag_disabled?: boolean | null;
	bio?: string | null;
}

export interface MatchResult {
	matched: boolean;
	persona?: PersonaLike;
	strippedContent: string;
	wasEscaped?: boolean;
	clearedLatch?: boolean;
	isFromTag?: boolean;
}

export interface MatchPersonaOptions {
	allowEmptyContent?: boolean;
}

export function matchPersona(
	text: string,
	personas: ReadonlyArray<PersonaLike>,
	activeLatchedPersonaId?: string | null,
	hasAttachments?: boolean,
	options?: MatchPersonaOptions,
): MatchResult {
	const latchedPersona = activeLatchedPersonaId
		? personas.find((p) => p.id === activeLatchedPersonaId && !p.auto_tag_disabled)
		: undefined;

	// Only process escape slashes and unlatch commands if a persona is currently latched
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
		if (persona.auto_tag_disabled) continue;
		const tags = persona.persona_tags;
		if (!tags || tags.length === 0) continue;

		for (const tag of tags) {
			const prefix = tag.prefix ?? '';
			const suffix = tag.suffix ?? '';
			if (!prefix && !suffix) continue;

			if (text.startsWith(prefix) && text.endsWith(suffix)) {
				const innerStart = prefix.length;
				const innerEnd = text.length - suffix.length;
				if (innerEnd > innerStart) {
					const inner = text.slice(innerStart, innerEnd).trim();
					if (inner.length > 0 || options?.allowEmptyContent) {
						candidates.push({
							persona,
							prefixLen: prefix.length,
							suffixLen: suffix.length,
							totalLen: prefix.length + suffix.length,
							innerContent: inner,
						});
					} else if (hasAttachments) {
						candidates.push({
							persona,
							prefixLen: prefix.length,
							suffixLen: suffix.length,
							totalLen: prefix.length + suffix.length,
							innerContent: '',
						});
					}
				} else if (innerEnd === innerStart && (hasAttachments || options?.allowEmptyContent)) {
					candidates.push({
						persona,
						prefixLen: prefix.length,
						suffixLen: suffix.length,
						totalLen: prefix.length + suffix.length,
						innerContent: '',
					});
				}
			} else if (hasAttachments && prefix.length > 0 && (text.startsWith(prefix) || text.trim() === prefix.trim())) {
				// When attachments are present, allow matching just the persona's prefix (with no other text)
				const remainder = text.startsWith(prefix) ? text.slice(prefix.length).trim() : '';
				if (remainder.length === 0) {
					candidates.push({
						persona,
						prefixLen: prefix.length,
						suffixLen: 0,
						totalLen: prefix.length,
						innerContent: '',
					});
				}
			} else if (hasAttachments && suffix.length > 0 && (text.endsWith(suffix) || text.trim() === suffix.trim())) {
				// When attachments are present, allow matching just the persona's suffix (with no other text)
				const remainder = text.endsWith(suffix) ? text.slice(0, text.length - suffix.length).trim() : '';
				if (remainder.length === 0) {
					candidates.push({
						persona,
						prefixLen: 0,
						suffixLen: suffix.length,
						totalLen: suffix.length,
						innerContent: '',
					});
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
			isFromTag: true,
		};
	}

	// Fallback to active latched persona if one is set
	if (latchedPersona) {
		return {
			matched: true,
			persona: latchedPersona,
			strippedContent: text,
			isFromTag: false,
		};
	}

	return {
		matched: false,
		strippedContent: text,
		isFromTag: false,
	};
}

export function previewPersona(
	text: string,
	personas: ReadonlyArray<PersonaLike>,
	activeLatchedPersonaId?: string | null,
	hasAttachments?: boolean,
): {persona: PersonaLike | null; isFromTag: boolean} {
	const result = matchPersona(text, personas, activeLatchedPersonaId, hasAttachments, {
		allowEmptyContent: true,
	});

	if (result.wasEscaped || result.clearedLatch) {
		return {persona: null, isFromTag: false};
	}

	if (result.matched && result.persona) {
		return {persona: result.persona, isFromTag: Boolean(result.isFromTag)};
	}

	return {persona: null, isFromTag: false};
}

export const matchPersonaTags = matchPersona;
