// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: "Add a space after emoji" (Accessibility.spaceAfterEmoji, tyne-chat/tyne#650). Upstream adds
// a space after every emoji chosen in the message box, from the picker or the `:` search; with the
// setting off, an emoji is put in with nothing after it, so the next one touches it. Mentions,
// channels and the other insertions keep upstream's spacing, and so does an emoji that a caller
// already asked to have no space.

import Accessibility from '@app/features/accessibility/state/Accessibility';
import type {ComposerInsertPayload, ComposerInsertSpacing} from '@app/features/lexical/composer/composerOffsets';

export function emojiInsertSpacing(
	payload: ComposerInsertPayload,
	spacing: ComposerInsertSpacing,
): ComposerInsertSpacing {
	if (Accessibility.spaceAfterEmoji) {
		return spacing;
	}
	if (payload.kind !== 'customEmoji' && payload.kind !== 'standardEmoji') {
		return spacing;
	}
	return {...spacing, trailing: false};
}
