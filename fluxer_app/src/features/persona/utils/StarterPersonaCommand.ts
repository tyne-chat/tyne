// SPDX-License-Identifier: AGPL-3.0-or-later

import {CloudUpload} from '@app/features/messaging/upload/CloudUpload';
import {consumePersonaCommand} from '@app/features/persona/utils/OutgoingPersona';
import {resolveStarterArgs} from '@app/features/threads/utils/ThreadStarterSend';

/**
 * `consumePersonaCommand` for the composers that start a thread or a forum post. Their sticker and
 * meme come in the shape `resolveStarterArgs` reads, and their attachments wait under `draftKey`.
 * Kept out of `OutgoingPersona`, which `MessageCommands` imports: `ThreadStarterSend` imports it back.
 */
export function consumeStarterPersonaCommand(
	parentId: string,
	draftKey: string,
	content: string,
	hasAttachments: boolean,
	...starterArgs: Parameters<typeof resolveStarterArgs>
): boolean {
	const {stickers, favoriteMemeId} = resolveStarterArgs(...starterArgs);
	const hasMedia =
		hasAttachments ||
		CloudUpload.getTextareaAttachments(draftKey).length > 0 ||
		stickers.length > 0 ||
		favoriteMemeId !== undefined;
	return consumePersonaCommand(parentId, content, hasMedia);
}
