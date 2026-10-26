// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a page asked for `before` the window's first message or `after` its last fits only that
// window (tyne-chat/tyne#212). If the window changes while the request is out (a live message trims
// it from the top, a reload replaces it), upstream's `applyLoadedWindow` joins the page on anyway
// and clears the buffer that held the messages in between, which leaves a gap in the history until
// the channel is reloaded. A page that lands on a window being reloaded becomes the whole window,
// taken for the live tail. The Android app drops such a page (`applyOlderPage`, `applyNewerPage`);
// so does this, after one repair: messages trimmed from the top are in the buffer, so a page of them
// is served first, as the next scroll would, and when that reaches the cursor the page is applied.

import type {ChannelMessages} from '@app/features/messaging/state/ChannelMessages';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {MAX_MESSAGES_PER_CHANNEL} from '@fluxer/constants/src/LimitConstants';

const logger = new Logger('ForkMessagePageFit');

// The load a request belongs to: `beginLoad` gives every network load a new generation.
export function messageLoadGeneration(channelId: string): number | null {
	return Messages.getCachedMessages(channelId)?.loadGeneration ?? null;
}

export function messagePageFitsWindow(
	window: ChannelMessages | undefined,
	before: string | null,
	after: string | null,
): boolean {
	if (before == null && after == null) return true;
	if (window == null || !window.ready) return false;
	if (before != null && window.first()?.id !== before) return false;
	if (after != null && window.last()?.id !== after) return false;
	return true;
}

// Whether the window still waits for this load: no newer load started, and nothing else ended it
// (a reload, a jump, a page served from the buffers). Only then may this load end `loadingMore`.
function loadOwnsWindow(window: ChannelMessages | undefined, loadGeneration: number | null): boolean {
	return window?.loadingMore === true && window.loadGeneration === loadGeneration;
}

// Returns true when the page was dropped. A load that jumps or replaces the window always applies.
export function dropMessagePageThatNoLongerFits(
	channelId: string,
	before: string | null,
	after: string | null,
	hasJump: boolean,
	loadGeneration: number | null,
): boolean {
	if (hasJump) return false;
	let window = Messages.getCachedMessages(channelId);
	if (messagePageFitsWindow(window, before, after)) return false;
	const first = window?.first();
	if (before != null && window?.ready && first != null && loadOwnsWindow(window, loadGeneration)) {
		if (window.canServeOlderFrom(first.id)) {
			Messages.handleLoadMessagesSuccessCached({channelId, before: first.id, limit: MAX_MESSAGES_PER_CHANNEL});
			window = Messages.getCachedMessages(channelId);
			if (messagePageFitsWindow(window, before, after)) return false;
		}
	}
	logger.debug(
		`Dropping the page ${before != null ? `before ${before}` : `after ${after}`} in channel ${channelId}: the window changed while it loaded`,
	);
	if (loadOwnsWindow(window, loadGeneration)) {
		Messages.handleLoadMessagesBlocked({channelId});
	}
	return true;
}
