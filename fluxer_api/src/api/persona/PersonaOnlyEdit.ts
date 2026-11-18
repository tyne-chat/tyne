// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageUpdateRequest} from '@app/api/channel/MessageTypes';

/**
 * An edit that changes who a message is from and nothing else: it names a persona (or `null`, the
 * account) and carries no content, flags, embeds, attachments or mentions. A forward may take one
 * although it is otherwise never edited, because its words are in its snapshots and only its sender
 * changes (tyne-chat/tyne#817); such an edit leaves the message's content alone, so it is not
 * checked as content either.
 */
export function isPersonaOnlyEdit(data: MessageUpdateRequest): boolean {
	const request = data as Record<string, unknown>;
	if (request.persona_id === undefined && request.subprofile === undefined) return false;
	return Object.entries(request).every(
		([key, value]) => key === 'persona_id' || key === 'subprofile' || value === undefined,
	);
}
