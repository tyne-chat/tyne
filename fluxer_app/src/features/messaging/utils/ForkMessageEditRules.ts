// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the edit rules of tyne-chat/tyne#904. An edit replaces the text with whatever follows the persona tag, a tag
// changes the persona, and an edit cannot leave a message with nothing in it. So a tag with nothing after it counts as
// no text: on a message with nothing else the edit is handled as an empty one (upstream offers to delete the message),
// and on a message with attachments or stickers it removes the text, as upstream's "Keep attachments when clearing an
// edit" does, and changes the persona.

import {
	canSubmitEmptyMessageEdit,
	isAttachmentOnlyMessage,
} from '@app/features/messaging/utils/MessageEditContentUtils';
import {hasVisibleMessageContent} from '@app/features/messaging/utils/MessageRequestUtils';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import AdvancedSettings from '@app/features/user/state/AdvancedSettings';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';

interface EditedMessage {
	readonly content: string;
	readonly attachments: ReadonlyArray<{id: string}>;
	readonly stickers?: ReadonlyArray<unknown> | null;
	readonly subprofile?: MessageSubprofileResponse | null;
}

interface EditText {
	/** The text the edit leaves once its persona tag is taken off; empty when none of it is visible. */
	readonly text: string;
	/** The persona a typed tag or `\` asks for; undefined when the edit names none. */
	readonly subprofile: MessageSubprofileResponse | null | undefined;
}

/** What an edit leaves once its persona tag is taken off. */
export function resolveEditText(content: string, message: EditedMessage): EditText {
	const match = PersonaStore.matchEditMessage(content, message.subprofile, {originalContent: message.content});
	return {
		text: hasVisibleMessageContent(match.finalContent) ? match.finalContent : '',
		subprofile: match.subprofile,
	};
}

function hasStickers(message: EditedMessage): boolean {
	return (message.stickers?.length ?? 0) > 0;
}

/** A message with no text to remove, so an edit that leaves none can only change its persona. Upstream's
 * `isAttachmentOnlyMessage`, with stickers counted as attachments. */
export function hasNoTextToRemove(message: EditedMessage): boolean {
	return isAttachmentOnlyMessage(message) || (message.content.length === 0 && hasStickers(message));
}

/** Whether an edit that leaves no text removes the text and keeps the message. Upstream's
 * `canSubmitEmptyMessageEdit`, with stickers counted as attachments. */
export function canRemoveText(message: EditedMessage): boolean {
	return (
		canSubmitEmptyMessageEdit(message) || (AdvancedSettings.keepAttachmentsOnEmptyMessageEdit && hasStickers(message))
	);
}
