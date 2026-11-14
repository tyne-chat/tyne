// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork, a stopgap until upstream fixes its own bug (tyne-chat/tyne#635). A channel restored from the
// boot snapshot mounts only its newest rows and holds the older ones aside, behind a blank reserve of
// their height (`Messages.deferSeededOlderMessages`). Upstream adds them back in
// `ScrollManager.loadDeferredOlderWhenScrollSettles`, which gives up while the list is at the bottom
// (`if (this.pinIsAtBottom && !userRequested) return;`) and runs again only from `loadMore`, near the
// top of the list. So scrolling up from the bottom crossed the whole blank reserve before anything
// loaded. Here, once the restored list is shown and has settled at the bottom, every held row comes
// back at once. A list restored above the bottom keeps upstream's path, which adds them there.
//
// Remove it when upstream fixes this: when that early return goes, the load trigger counts the
// reserve, or upstream otherwise adds held rows back before the reserve can be scrolled into. Take
// upstream's and delete this file, its test and the call in `ScrollManager.restoreInitial` (with its
// fork import). If upstream drops the deferral itself, the call stops compiling: delete the same.
// Check: quit the desktop app at the bottom of a busy channel, restart it, scroll up; the history
// above must show without a blank band. Until then this is harmless next to upstream's path.

import {afterBootReveal} from '@app/features/boot_state/BootReveal';
import Messages from '@app/features/messaging/state/MessagingMessages';

// Upstream's settle time before it adds held rows (`DEFERRED_OLDER_SCROLL_SETTLE_MS`): the restored
// list's first frames are drawn before the extra rows.
const SETTLE_MS = 120;

export function prependDeferredOlderAtBottom(channelId: string, atBottom: () => boolean): void {
	afterBootReveal(() => {
		setTimeout(() => {
			if (atBottom() && Messages.hasDeferredOlderMessages(channelId)) {
				Messages.prependDeferredOlderMessages(channelId);
			}
		}, SETTLE_MS);
	});
}
