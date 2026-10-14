// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import * as ReactionCommands from '@app/features/messaging/commands/ReactionCommands';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {hasPersonaReacted, toReactionEmoji} from '@app/features/messaging/utils/ReactionUtils';
import {fetchPersonas} from '@app/features/persona/commands/PersonaCommands';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {PersonaTag} from '@app/features/persona/components/PersonaTag';
import {type ClientPersona, PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {Check, MagnifyingGlass} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import styles from './PersonaReactAsModal.module.css';

export const REACT_AS_DESCRIPTOR = msg({
	message: 'React as...',
	comment: 'Title of the modal and context menu item to react as a persona.',
});

export const SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Search personas, tags, pronouns...',
	comment: 'Search placeholder in persona picker sheet',
});

interface PersonaReactAsModalProps {
	emoji: FlatEmoji;
	channelId: string;
	messageId: string;
	onClose: () => void;
}

type SelectableItem = {type: 'root'} | {type: 'persona'; persona: ClientPersona};

export const PersonaReactAsModal: React.FC<PersonaReactAsModalProps> = observer(
	({emoji, channelId, messageId, onClose}) => {
		const {i18n} = useLingui();
		const [query, setQuery] = useState('');
		const [selectedIndex, setSelectedIndex] = useState(0);
		const searchInputRef = useRef<HTMLInputElement>(null);
		const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
		const currentUser = Users.getCurrentUser();
		const personas = PersonaStore.sortedPersonas;

		useEffect(() => {
			void fetchPersonas();
		}, []);

		const reactionEmoji = useMemo(() => toReactionEmoji(emoji as any), [emoji]);
		const message = Messages.getMessage(channelId, messageId);
		const existingReaction = message ? message.getReaction(reactionEmoji) : undefined;

		const originalUrl = emoji.id
			? AvatarUtils.getEmojiOriginalURL({id: emoji.id, animated: emoji.animated})
			: (emoji.url ?? null);

		const filteredPersonas = useMemo(() => {
			const trimmed = query.trim().toLowerCase();
			if (!trimmed) return personas;
			return personas.filter((p) => {
				if (p.name.toLowerCase().includes(trimmed)) return true;
				if (PersonaStore.displayTagText?.toLowerCase().includes(trimmed)) return true;
				if (p.pronouns?.toLowerCase().includes(trimmed)) return true;
				return (p.persona_tags ?? []).some(
					(tag) => tag.prefix?.toLowerCase().includes(trimmed) || tag.suffix?.toLowerCase().includes(trimmed),
				);
			});
		}, [personas, query]);

		const selectableItems = useMemo<Array<SelectableItem>>(() => {
			const items: Array<SelectableItem> = [];
			if (currentUser && !query.trim()) {
				items.push({type: 'root'});
			}
			for (const p of filteredPersonas) {
				items.push({type: 'persona', persona: p});
			}
			return items;
		}, [currentUser, query, filteredPersonas]);

		const isRootReacted = hasPersonaReacted(existingReaction, null);

		// Initialize selectedIndex to active reaction if available
		useEffect(() => {
			if (isRootReacted) {
				setSelectedIndex(0);
			} else {
				const activeIdx = selectableItems.findIndex(
					(item) => item.type === 'persona' && hasPersonaReacted(existingReaction, item.persona.id),
				);
				if (activeIdx >= 0) {
					setSelectedIndex(activeIdx);
				}
			}
		}, []);

		// Autoscroll highlighted item into view
		useEffect(() => {
			const el = itemRefs.current[selectedIndex];
			if (el) {
				el.scrollIntoView({block: 'nearest'});
			}
		}, [selectedIndex]);

		const handleSelect = useCallback(
			(personaId: string | null) => {
				const hasReacted = hasPersonaReacted(existingReaction, personaId);
				if (hasReacted) {
					ReactionCommands.removeReaction(i18n, channelId, messageId, reactionEmoji, undefined, personaId);
				} else {
					ReactionCommands.addReaction(i18n, channelId, messageId, reactionEmoji, personaId);
				}
				onClose();
				PopoutCommands.closeAll();
			},
			[channelId, existingReaction, i18n, messageId, onClose, reactionEmoji],
		);

		const handleItemKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, personaId: string | null) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			e.preventDefault();
			handleSelect(personaId);
		};

		const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
			if (selectableItems.length === 0) return;

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedIndex((prev) => (prev + 1) % selectableItems.length);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedIndex((prev) => (prev - 1 + selectableItems.length) % selectableItems.length);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				const item = selectableItems[selectedIndex];
				if (item) {
					if (item.type === 'root') {
						handleSelect(null);
					} else {
						handleSelect(item.persona.id);
					}
				}
			}
		};

		let currentItemIndex = 0;

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
							{originalUrl ? (
								<img
									src={originalUrl}
									alt={emoji.name}
									className={styles.emojiPreviewImage}
									data-flx="persona.persona-react-as-modal.emoji-preview-image"
								/>
							) : (
								<span className={styles.emojiSurrogate} data-flx="persona.persona-react-as-modal.emoji-surrogate">
									{emoji.surrogates ?? emoji.name}
								</span>
							)}
						</div>
					}
					onClose={onClose}
					data-flx="persona.persona-react-as-modal.header"
				>
					<div className={styles.searchInputWrapper} data-flx="persona.persona-react-as-modal.search-input-wrapper">
						<MagnifyingGlass
							className={styles.searchIcon}
							size={16}
							weight="bold"
							data-flx="persona.persona-react-as-modal.search-icon"
						/>
						<input
							ref={searchInputRef}
							type="text"
							className={styles.searchInput}
							placeholder={i18n._(SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR)}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setSelectedIndex(0);
							}}
							onKeyDown={handleKeyDown}
							data-flx="persona.persona-react-as-modal.search-input.set-query.text"
						/>
					</div>
				</Modal.Header>

				<Modal.Content padding="none" className={styles.modalContent} data-flx="persona.persona-react-as-modal.content">
					<div className={styles.listContainer} data-flx="persona.persona-react-as-modal.list-container">
						{/* Root Account */}
						{currentUser &&
							!query.trim() &&
							(() => {
								const itemIdx = currentItemIndex++;
								const isSelected = selectedIndex === itemIdx;
								return (
									<div
										key="root-account"
										ref={(el) => {
											itemRefs.current[itemIdx] = el;
										}}
										className={clsx(
											styles.personaItem,
											isRootReacted && styles.active,
											isSelected && styles.keyboardSelected,
										)}
										onClick={() => handleSelect(null)}
										onKeyDown={(e) => handleItemKeyDown(e, null)}
										onMouseEnter={() => setSelectedIndex(itemIdx)}
										role="button"
										tabIndex={0}
										data-flx="persona.persona-react-as-modal.root-account-item"
									>
										<Avatar user={currentUser} size={32} data-flx="persona.persona-react-as-modal.avatar" />
										<div className={styles.personaDetails} data-flx="persona.persona-react-as-modal.persona-details">
											<div
												className={styles.personaPrimaryRow}
												data-flx="persona.persona-react-as-modal.persona-primary-row"
											>
												<span className={styles.personaName} data-flx="persona.persona-react-as-modal.persona-name">
													{currentUser.username}
												</span>
											</div>
											<span
												className={styles.personaPronouns}
												data-flx="persona.persona-react-as-modal.persona-pronouns"
											>
												<Trans>Root Account (Default)</Trans>
											</span>
										</div>
										{isRootReacted && (
											<Check
												size={18}
												weight="bold"
												className={styles.activeCheck}
												data-flx="persona.persona-react-as-modal.active-check"
											/>
										)}
									</div>
								);
							})()}

						{/* Section Title */}
						<div className={styles.sectionTitle} data-flx="persona.persona-react-as-modal.section-title">
							{query.trim() ? <Trans>Search Results ({filteredPersonas.length})</Trans> : <Trans>Personas</Trans>}
						</div>

						{/* Personas List */}
						{filteredPersonas.length === 0 ? (
							<div className={styles.emptyNotice} data-flx="persona.persona-react-as-modal.empty-notice">
								<Trans>No matching personas found.</Trans>
							</div>
						) : (
							filteredPersonas.map((p) => {
								const itemIdx = currentItemIndex++;
								const isSelected = selectedIndex === itemIdx;
								const hasReacted = hasPersonaReacted(existingReaction, p.id);

								return (
									<div
										key={p.id}
										ref={(el) => {
											itemRefs.current[itemIdx] = el;
										}}
										className={clsx(
											styles.personaItem,
											hasReacted && styles.active,
											isSelected && styles.keyboardSelected,
										)}
										onClick={() => handleSelect(p.id)}
										onKeyDown={(e) => handleItemKeyDown(e, p.id)}
										onMouseEnter={() => setSelectedIndex(itemIdx)}
										role="button"
										tabIndex={0}
										data-flx="persona.persona-react-as-modal.persona-item"
									>
										{currentUser && (
											<PersonaAvatar
												user={currentUser}
												persona={PersonaStore.getKnownPersona(p.id)}
												size={32}
												data-flx="persona.persona-react-as-modal.persona-avatar"
											/>
										)}
										<div className={styles.personaDetails} data-flx="persona.persona-react-as-modal.persona-details--2">
											<div
												className={styles.personaPrimaryRow}
												data-flx="persona.persona-react-as-modal.persona-primary-row--2"
											>
												<span className={styles.personaName} data-flx="persona.persona-react-as-modal.persona-name--2">
													{p.name}
												</span>
												<PersonaTag subprofile={p as any} data-flx="persona.persona-react-as-modal.persona-tag" />
											</div>
											{p.pronouns && (
												<span
													className={styles.personaPronouns}
													title={p.pronouns}
													data-flx="persona.persona-react-as-modal.persona-pronouns--2"
												>
													{p.pronouns}
												</span>
											)}
										</div>
										{hasReacted && (
											<Check
												size={18}
												weight="bold"
												className={styles.activeCheck}
												data-flx="persona.persona-react-as-modal.active-check--2"
											/>
										)}
									</div>
								);
							})
						)}
					</div>
				</Modal.Content>
			</Modal.Root>
		);
	},
);

PersonaReactAsModal.displayName = 'PersonaReactAsModal';
