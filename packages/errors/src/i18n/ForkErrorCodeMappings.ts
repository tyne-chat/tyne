// SPDX-License-Identifier: AGPL-3.0-or-later

import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';

// Fork: the messages for the fork's API error codes. Upstream's ErrorCodeToI18nKey takes them in by
// one spread, at the place they always had.

export const ForkErrorCodeToI18nKey = {
	[APIErrorCodes.UNKNOWN_PERSONA]: 'unknown_entities.unknown_user',
	[APIErrorCodes.PERSONA_NOT_FOUND]: 'unknown_entities.unknown_user',
	[APIErrorCodes.PRIVATE_PERSONA]: 'permissions.missing_access',
	[APIErrorCodes.PERSONA_LIMIT_REACHED]: 'connections.limit_reached',
	[APIErrorCodes.DUPLICATE_PERSONA_TAG]: 'usernames_and_tags.tag_already_taken',
	[APIErrorCodes.PERSONA_TAG_LIMIT_REACHED]: 'connections.limit_reached',
	[APIErrorCodes.DUPLICATE_SIGNATURE_EMOJI]: 'usernames_and_tags.tag_already_taken',
	[APIErrorCodes.SIGNATURE_EMOJI_LIMIT_REACHED]: 'connections.limit_reached',
} as const;
