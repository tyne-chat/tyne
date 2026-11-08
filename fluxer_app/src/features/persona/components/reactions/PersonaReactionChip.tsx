// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {PersonaReactAsModal} from '@app/features/persona/components/PersonaReactAsModal';
import {
	isOwnReactionsPopoutOpen,
	toggleOwnReactionsPopout,
} from '@app/features/persona/components/reactions/OwnReactionsPopout';
import styles from '@app/features/persona/components/reactions/PersonaReactionChip.module.css';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {toggleOwnReaction} from '@app/features/persona/utils/OwnReactions';
import {
	countOwnReactions,
	opensOwnReactionsMenu,
	type ReactionIdentityId,
} from '@app/features/persona/utils/PersonaReactionIdentities';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretDownIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import type React from 'react';
import {useRef} from 'react';

const PRESS_TO_SEE_YOUR_REACTIONS_DESCRIPTOR = msg({
	message: 'press to see your reactions',
	comment:
		'Label in the message reactions, on an emoji one of your personas reacted with: pressing it lists your account and personas so you can add or remove each one. Keep the tone plain.',
});
// Upstream's words for the same thing, so its translations apply.
const PRESS_TO_REMOVE_REACTION_DESCRIPTOR = msg({
	message: 'press to remove reaction',
	comment: 'Label in the channel and chat message reactions. Keep the tone plain and specific.',
});

interface PersonaReactionChip {
	/** True once one of your identities reacted: a click then opens "Your reactions" instead of reacting. */
	opensMenu: boolean;
	/** "Your reactions" is open from this chip; its hover tooltip stays closed meanwhile. */
	isOpen: boolean;
	/** Spread on the chip's button: the popout's anchor, and its popup state for assistive tech. */
	buttonProps: {
		ref: React.RefObject<HTMLButtonElement | null>;
		'aria-haspopup'?: 'dialog';
		'aria-expanded'?: boolean;
	};
	/** Replaces upstream's "press to add/remove reaction" in the chip's label, when set. */
	actionText: string | null;
	/** Replaces upstream's pressed state when set: with one reaction per emoji, any of yours. */
	pressed: boolean | null;
	caret: React.ReactNode;
	/** Returns true when it handled the click. */
	handleClick: () => boolean;
}

/**
 * Fork: a reaction chip for an account with personas. While none of its identities reacted with the
 * emoji, the chip works as upstream's (react as the current persona). Once one has, by the account's
 * "React as several personas at once" setting: on, the chip shows a caret and a click opens "Your
 * reactions" (a dialog in the mobile layout), where each identity's reaction is added or removed;
 * off, a click removes the account's reactions with it, whichever identities gave them.
 */
export function usePersonaReactionChip(
	message: Message,
	reaction: MessageReaction,
	currentPersonaId: ReactionIdentityId,
): PersonaReactionChip {
	const {i18n} = useLingui();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const multi = PersonaStore.multiPersonaReactions;
	const opensMenu = opensOwnReactionsMenu(reaction, PersonaStore.personas, multi);
	const isOpen = opensMenu && isOwnReactionsPopoutOpen(message.id, reaction.emoji);
	const anyOwn = countOwnReactions(reaction) > 0;
	let actionText: string | null = null;
	if (opensMenu) actionText = i18n._(PRESS_TO_SEE_YOUR_REACTIONS_DESCRIPTOR);
	else if (!multi && anyOwn) actionText = i18n._(PRESS_TO_REMOVE_REACTION_DESCRIPTOR);
	return {
		opensMenu,
		isOpen,
		pressed: multi ? null : anyOwn,
		buttonProps: opensMenu ? {ref: buttonRef, 'aria-haspopup': 'dialog', 'aria-expanded': isOpen} : {ref: buttonRef},
		actionText,
		caret: opensMenu ? (
			<span
				className={clsx(styles.caret, isOpen && styles.caretOpen)}
				aria-hidden="true"
				data-flx="persona.reactions.persona-reaction-chip.use-persona-reaction-chip.caret"
			>
				<CaretDownIcon
					size={12}
					weight="bold"
					data-flx="persona.reactions.persona-reaction-chip.use-persona-reaction-chip.caret-down-icon"
				/>
			</span>
		) : null,
		handleClick: () => {
			if (!opensMenu && !multi) {
				const target = {i18n, channelId: message.channelId, messageId: message.id, emoji: reaction.emoji, reaction};
				toggleOwnReaction(target, currentPersonaId);
				return true;
			}
			if (!opensMenu) return false;
			if (MobileLayout.isMobileLayout()) {
				ModalCommands.push(
					modal(() => (
						<PersonaReactAsModal
							emoji={reaction.emoji}
							channelId={message.channelId}
							messageId={message.id}
							onClose={() => ModalCommands.pop()}
							data-flx="persona.reactions.persona-reaction-chip.handle-click.persona-react-as-modal"
						/>
					)),
				);
				return true;
			}
			const target = buttonRef.current;
			if (!target) return false;
			toggleOwnReactionsPopout(target, message, reaction.emoji, currentPersonaId);
			return true;
		},
	};
}
