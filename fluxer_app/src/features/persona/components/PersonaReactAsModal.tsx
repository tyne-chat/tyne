// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import Drafts from '@app/features/messaging/state/MessagingDrafts';
import {type ReactionEmoji, toReactionEmoji, useEmojiURL} from '@app/features/messaging/utils/ReactionUtils';
import {fetchPersonas} from '@app/features/persona/commands/PersonaCommands';
import {
	PersonaReactionList,
	useOwnReactionTarget,
} from '@app/features/persona/components/reactions/PersonaReactionList';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {countOwnReactions} from '@app/features/persona/utils/PersonaReactionIdentities';
import {Button} from '@app/features/ui/button/Button';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useMemo, useRef} from 'react';
import styles from './PersonaReactAsModal.module.css';

export const REACT_AS_DESCRIPTOR = msg({
	message: 'React as...',
	comment: 'Title of the modal and context menu item to react as a persona.',
});

const OWN_REACTED_COUNT_DESCRIPTOR = msg({
	message: '{count} of {total} reacted',
	comment:
		'Under the "React as..." title: how many of your identities (the account and its personas) reacted with this emoji, out of all of them. Preserve {count} and {total}.',
});

interface PersonaReactAsModalProps {
	emoji: FlatEmoji | ReactionEmoji;
	channelId: string;
	messageId: string;
	onClose: () => void;
}

export const PersonaReactAsModal: React.FC<PersonaReactAsModalProps> = observer(
	({emoji, channelId, messageId, onClose}) => {
		const {i18n} = useLingui();
		const searchInputRef = useRef<HTMLInputElement>(null);
		// A picker's emoji is converted; a reaction chip's already is one (toReactionEmoji would lose its name).
		const reactionEmoji = useMemo(
			() => ('uniqueName' in emoji ? toReactionEmoji(emoji as never) : (emoji as ReactionEmoji)),
			[emoji],
		);
		const emojiUrl = useEmojiURL({emoji: reactionEmoji});
		const reaction = useOwnReactionTarget(messageId, reactionEmoji);
		const ownCount = countOwnReactions(reaction);
		const total = PersonaStore.personas.length + 1;
		const currentPersonaId =
			PersonaStore.getEffectiveReactionPersona(channelId, reactionEmoji, Drafts.getDraft(channelId))?.id ?? null;

		useEffect(() => {
			void fetchPersonas();
		}, []);

		return (
			<Modal.Root
				size="small"
				centered
				initialFocusRef={searchInputRef}
				onClose={onClose}
				className={styles.modalRoot}
				data-flx="persona.persona-react-as-modal.root"
			>
				<Modal.Header
					title={<Trans>React as...</Trans>}
					icon={
						<div className={styles.emojiPreview} data-flx="persona.persona-react-as-modal.emoji-preview">
							{emojiUrl ? (
								<img
									src={emojiUrl}
									alt=""
									draggable={false}
									className={styles.emojiPreviewImage}
									data-flx="persona.persona-react-as-modal.emoji-preview-image"
								/>
							) : null}
						</div>
					}
					onClose={onClose}
					data-flx="persona.persona-react-as-modal.header"
				>
					{ownCount > 0 && (
						<div className={styles.ownCount} data-flx="persona.persona-react-as-modal.own-count">
							{i18n._(OWN_REACTED_COUNT_DESCRIPTOR, {count: ownCount, total})}
						</div>
					)}
				</Modal.Header>

				<Modal.Content padding="none" className={styles.modalContent} data-flx="persona.persona-react-as-modal.content">
					<PersonaReactionList
						channelId={channelId}
						messageId={messageId}
						emoji={reactionEmoji}
						currentPersonaId={currentPersonaId}
						onPicked={() => {
							onClose();
							PopoutCommands.closeAll();
						}}
						size="comfortable"
						searchInputRef={searchInputRef}
						data-flx="persona.persona-react-as-modal.persona-reaction-list"
					/>
				</Modal.Content>

				<Modal.Footer className={styles.footer} data-flx="persona.persona-react-as-modal.footer">
					<Button small variant="secondary" onClick={onClose} data-flx="persona.persona-react-as-modal.done">
						<Trans>Done</Trans>
					</Button>
				</Modal.Footer>
			</Modal.Root>
		);
	},
);

PersonaReactAsModal.displayName = 'PersonaReactAsModal';
