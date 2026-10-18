// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaStore, type PersonaStoreClass} from '@app/features/persona/state/PersonaStore';

/**
 * Fork: whether sending a sticker, GIF or meme uses up the text typed in the composer.
 *
 * A persona tag typed before picking one chooses who sends it, so a draft that is nothing but a tag
 * (or an escape such as `\\`) is used up by the send. Any other text was not sent and stays in the
 * composer, as it does upstream (tyne-chat/tyne#122). The check changes no state, so callers can
 * ask before the send and get the same answer the send itself acts on.
 */
export function isDraftUsedUpByExpression(
	channelId: string | null,
	draft: string,
	store: Pick<PersonaStoreClass, 'previewOutgoingContent'> = PersonaStore,
): boolean {
	if (draft.trim() === '') return false;
	return store.previewOutgoingContent(channelId, draft, false, {allowEmptyContent: true}).trim() === '';
}

/** Fork: empties the composer after an expression send that used up its text. */
export function clearComposerAfterExpression(
	draftUsedUp: boolean,
	clearComposer: (() => void) | undefined,
	setValue: (value: string) => void,
): void {
	if (!draftUsedUp) return;
	if (clearComposer) {
		clearComposer();
	} else {
		setValue('');
	}
}
