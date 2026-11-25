// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaBlocks} from '@app/features/persona/state/PersonaBlocks';
import Relationships from '@app/features/relationship/state/Relationships';

/**
 * Whether a message's author is blocked: the account (upstream's rule) or the persona it was sent
 * as (tyne-chat/tyne#921). Upstream's refresh after a block or unblock re-marks the loaded messages
 * with this, so that `MessagingMessage.blocked` follows both lists.
 */
export function isMessageAuthorBlocked(message: {author: {id: string}; subprofile?: {id: string} | null}): boolean {
	return (
		Relationships.isBlocked(message.author.id) || PersonaBlocks.isBlocked(message.author.id, message.subprofile?.id)
	);
}
