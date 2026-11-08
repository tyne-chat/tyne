// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ReactionCommands from '@app/features/messaging/commands/ReactionCommands';
import {hasPersonaReacted, type ReactionEmoji} from '@app/features/messaging/utils/ReactionUtils';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {ownReactedIds, type ReactionIdentityId} from '@app/features/persona/utils/PersonaReactionIdentities';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {I18n} from '@lingui/core';

interface ReactionTarget {
	i18n: I18n;
	channelId: string;
	messageId: string;
	emoji: ReactionEmoji;
	/** The message's reaction with `emoji`, as it is now; undefined while nobody has reacted. */
	reaction: MessageReaction | undefined | null;
}

/**
 * Fork: picking an emoji for a message (the emoji picker, quick reactions, a reaction chip that opens
 * no menu), by the account's "React as several personas at once" setting (tyne-chat/tyne#86).
 * - On: toggles the current persona's reaction, as before.
 * - Off: one reaction per emoji. If any of the account's identities reacted, all of theirs are
 *   removed; otherwise it reacts as the current persona.
 * One request per reaction added or removed: at most one per identity, from one click.
 */
export function toggleOwnReaction(target: ReactionTarget, currentId: ReactionIdentityId): void {
	const {i18n, channelId, messageId, emoji, reaction} = target;
	if (PersonaStore.multiPersonaReactions) {
		if (hasPersonaReacted(reaction, currentId)) {
			ReactionCommands.removeReaction(i18n, channelId, messageId, emoji, undefined, currentId);
		} else {
			ReactionCommands.addReaction(i18n, channelId, messageId, emoji, currentId);
		}
		return;
	}
	const mine = ownReactedIds(reaction);
	if (mine.length > 0) {
		for (const id of mine) ReactionCommands.removeReaction(i18n, channelId, messageId, emoji, undefined, id);
		return;
	}
	ReactionCommands.addReaction(i18n, channelId, messageId, emoji, currentId);
}

/**
 * Fork: "React as…" with the setting off, a single choice. Picking the identity that reacted removes
 * its reaction; picking another replaces whichever of the account's reacted (removes those, adds this).
 */
export function reactAsOnly(target: ReactionTarget, id: ReactionIdentityId): void {
	const {i18n, channelId, messageId, emoji, reaction} = target;
	if (hasPersonaReacted(reaction, id)) {
		ReactionCommands.removeReaction(i18n, channelId, messageId, emoji, undefined, id);
		return;
	}
	for (const other of ownReactedIds(reaction)) {
		ReactionCommands.removeReaction(i18n, channelId, messageId, emoji, undefined, other);
	}
	ReactionCommands.addReaction(i18n, channelId, messageId, emoji, id);
}
