// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's API error codes. Upstream's APIErrorCodes takes them in by one spread, at the
// place they always had, so the codes and their order are unchanged.

export const ForkAPIErrorCodes = {
	UNKNOWN_PERSONA: 'UNKNOWN_PERSONA',
	PERSONA_NOT_FOUND: 'PERSONA_NOT_FOUND',
	PERSONA_LIMIT_REACHED: 'PERSONA_LIMIT_REACHED',
} as const;
