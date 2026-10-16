// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's API error codes. Upstream's APIErrorCodes takes them in by one spread, at the
// place they always had, so the codes and their order are unchanged.

export const ForkAPIErrorCodes = {
	UNKNOWN_PERSONA: 'UNKNOWN_PERSONA',
	PRIVATE_PERSONA: 'PRIVATE_PERSONA',
	PERSONA_LIMIT_REACHED: 'PERSONA_LIMIT_REACHED',
	DUPLICATE_PERSONA_TAG: 'DUPLICATE_PERSONA_TAG',
	PERSONA_TAG_LIMIT_REACHED: 'PERSONA_TAG_LIMIT_REACHED',
	DUPLICATE_SIGNATURE_EMOJI: 'DUPLICATE_SIGNATURE_EMOJI',
	SIGNATURE_EMOJI_LIMIT_REACHED: 'SIGNATURE_EMOJI_LIMIT_REACHED',
} as const;
