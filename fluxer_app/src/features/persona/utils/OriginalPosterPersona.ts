// SPDX-License-Identifier: AGPL-3.0-or-later

import ChannelThreads from '@app/features/threads/state/ChannelThreads';

/**
 * Whether a message by the account that started a forum post gets the "OP" tag.
 *
 * Upstream tags every message by that account. Here the tag follows the identity the post was
 * started as: when it was started as a persona, only messages sent as that persona are tagged, and
 * when it was started as the account itself, only messages sent as the account are. Another
 * persona of the same account, or the account behind a persona, is not presented as the original
 * poster.
 */
export function originalPosterTagApplies(
	messagePersonaId: string | null | undefined,
	threadOwnerPersonaId: string | null | undefined,
): boolean {
	return (messagePersonaId || null) === (threadOwnerPersonaId || null);
}

/** The rule above for a message in its thread. Call from an observer component. */
export function originalPosterTagAppliesToMessage(message: {
	channelId: string;
	subprofile?: {id: string} | null;
}): boolean {
	return originalPosterTagApplies(message.subprofile?.id, ChannelThreads.getThread(message.channelId)?.ownerPersonaId);
}
