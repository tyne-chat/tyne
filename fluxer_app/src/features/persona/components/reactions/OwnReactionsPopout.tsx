// SPDX-License-Identifier: AGPL-3.0-or-later

import {CLOSE_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {
	getEmojiName,
	getReactionKey,
	type ReactionEmoji,
	useEmojiURL,
} from '@app/features/messaging/utils/ReactionUtils';
import styles from '@app/features/persona/components/reactions/OwnReactionsPopout.module.css';
import {
	PersonaReactionList,
	useOwnReactionTarget,
} from '@app/features/persona/components/reactions/PersonaReactionList';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {countOwnReactions, type ReactionIdentityId} from '@app/features/persona/utils/PersonaReactionIdentities';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import PopoutState from '@app/features/ui/state/Popout';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {XIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

const YOUR_REACTIONS_LABEL_DESCRIPTOR = msg({
	message: 'Your {emojiName} reactions',
	comment: 'Accessible name of the popout listing which of your personas reacted with an emoji. Preserve {emojiName}.',
});
const OWN_REACTION_COUNT_DESCRIPTOR = msg({
	message: '{count} of {total}',
	comment:
		'In the "Your reactions" popout: how many of your identities (the account and its personas) reacted, out of all of them. Preserve {count} and {total}.',
});

interface OwnReactionsPopoutProps {
	channelId: string;
	messageId: string;
	emoji: ReactionEmoji;
	currentPersonaId: ReactionIdentityId;
	onClose: () => void;
}

/** Fork: "Your reactions", opened from a reaction chip once one of your identities has reacted with it. */
export const OwnReactionsPopout = observer(
	({channelId, messageId, emoji, currentPersonaId, onClose}: OwnReactionsPopoutProps) => {
		const {i18n} = useLingui();
		const reaction = useOwnReactionTarget(messageId, emoji);
		const emojiUrl = useEmojiURL({emoji});
		const ownCount = countOwnReactions(reaction);
		const total = PersonaStore.personas.length + 1;

		return (
			<div
				className={styles.popout}
				role="dialog"
				aria-label={i18n._(YOUR_REACTIONS_LABEL_DESCRIPTOR, {emojiName: getEmojiName(emoji)})}
				data-flx="persona.own-reactions-popout.root"
			>
				<div className={styles.header} data-flx="persona.reactions.own-reactions-popout.header">
					{emojiUrl ? (
						<img
							src={emojiUrl}
							alt=""
							draggable={false}
							className={styles.headerEmoji}
							data-flx="persona.reactions.own-reactions-popout.header-emoji"
						/>
					) : null}
					<span className={styles.title} data-flx="persona.reactions.own-reactions-popout.title">
						<Trans>Your reactions</Trans>
					</span>
					<span className={styles.count} data-flx="persona.reactions.own-reactions-popout.count">
						{i18n._(OWN_REACTION_COUNT_DESCRIPTOR, {count: ownCount, total})}
					</span>
					<button
						type="button"
						className={styles.close}
						aria-label={i18n._(CLOSE_DESCRIPTOR)}
						onClick={onClose}
						data-flx="persona.own-reactions-popout.close"
					>
						<XIcon
							size={14}
							weight="bold"
							aria-hidden="true"
							data-flx="persona.reactions.own-reactions-popout.x-icon"
						/>
					</button>
				</div>
				<PersonaReactionList
					channelId={channelId}
					messageId={messageId}
					emoji={emoji}
					currentPersonaId={currentPersonaId}
					size="compact"
					autoFocus
					data-flx="persona.reactions.own-reactions-popout.persona-reaction-list"
				/>
			</div>
		);
	},
);

OwnReactionsPopout.displayName = 'OwnReactionsPopout';

export function ownReactionsPopoutKey(messageId: string, emoji: ReactionEmoji): string {
	return `own-reactions-${getReactionKey(messageId, emoji)}`;
}

export function isOwnReactionsPopoutOpen(messageId: string, emoji: ReactionEmoji): boolean {
	return PopoutState.isOpen(ownReactionsPopoutKey(messageId, emoji));
}

/** Opens "Your reactions" under the chip, or closes it when it is already open. */
export function toggleOwnReactionsPopout(
	target: HTMLElement,
	message: Message,
	emoji: ReactionEmoji,
	currentPersonaId: ReactionIdentityId,
): void {
	const key = ownReactionsPopoutKey(message.id, emoji);
	if (PopoutState.isOpen(key)) {
		PopoutCommands.close(key);
		return;
	}
	PopoutCommands.open({
		key,
		target,
		position: 'bottom-start',
		animationType: 'none',
		render: ({onClose}) => (
			<OwnReactionsPopout
				channelId={message.channelId}
				messageId={message.id}
				emoji={emoji}
				currentPersonaId={currentPersonaId}
				onClose={onClose}
				data-flx="persona.reactions.own-reactions-popout.toggle-own-reactions-popout.own-reactions-popout"
			/>
		),
	});
}
