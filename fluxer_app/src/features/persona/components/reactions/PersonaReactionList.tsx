// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ReactionCommands from '@app/features/messaging/commands/ReactionCommands';
import {useMessageReactions} from '@app/features/messaging/hooks/useMessageReactionStore';
import {
	emojiEquals,
	hasPersonaReacted,
	type ReactionEmoji,
	useEmojiURL,
} from '@app/features/messaging/utils/ReactionUtils';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR} from '@app/features/persona/components/PersonaPickerSheet';
import {PersonaTag} from '@app/features/persona/components/PersonaTag';
import styles from '@app/features/persona/components/reactions/PersonaReactionList.module.css';
import {type ClientPersona, PersonaStore} from '@app/features/persona/state/PersonaStore';
import {reactAsOnly} from '@app/features/persona/utils/OwnReactions';
import {
	orderIdentitiesForReaction,
	personaMatchesQuery,
	type ReactionIdentityId,
	recentPersonaIds,
} from '@app/features/persona/utils/PersonaReactionIdentities';
import {Avatar} from '@app/features/ui/components/Avatar';
import Users from '@app/features/user/state/Users';
import {Trans, useLingui} from '@lingui/react/macro';
import {CheckIcon, MagnifyingGlassIcon, PlusIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';

const RECENT_LIMIT = 6;
// Below this many personas the whole list fits on screen, so a Recent row would only repeat it.
const RECENT_MIN_PERSONAS = 7;

interface PersonaReactionListProps {
	channelId: string;
	messageId: string;
	emoji: ReactionEmoji;
	/** The persona a plain click on the chip reacts as (`null`: the account). Listed first, marked Current. */
	currentPersonaId: ReactionIdentityId;
	/** With "React as several personas at once" off: called after a pick, to close the dialog. */
	onPicked?: () => void;
	size: 'compact' | 'comfortable';
	searchInputRef?: React.RefObject<HTMLInputElement | null>;
	autoFocus?: boolean;
}

interface Section {
	key: string;
	title: React.ReactNode | null;
	ids: Array<ReactionIdentityId>;
}

/**
 * Fork: the account and its personas, each with a toggle for one emoji on one message. Shared by the
 * "Your reactions" popout on a reaction chip and the "React as…" dialog. A click (or Enter, or Space)
 * toggles and the list stays open, so several of a system's members can react in a row; clicking
 * outside, Escape or the close button ends it. One toggle is one request. With the account's "React
 * as several personas at once" off, a pick is a single choice (it replaces any other of the
 * account's reactions with the emoji) and `onPicked` closes the dialog.
 */
export const PersonaReactionList = observer(
	({
		channelId,
		messageId,
		emoji,
		currentPersonaId,
		onPicked,
		size,
		searchInputRef,
		autoFocus = false,
	}: PersonaReactionListProps) => {
		const {i18n} = useLingui();
		const currentUser = Users.getCurrentUser();
		const personas = PersonaStore.sortedPersonas;
		const reaction = useOwnReactionTarget(messageId, emoji);
		const emojiUrl = useEmojiURL({emoji});
		const [query, setQuery] = useState('');
		const [activeIndex, setActiveIndex] = useState(0);
		const localSearchRef = useRef<HTMLInputElement>(null);
		const inputRef = searchInputRef ?? localSearchRef;
		const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

		// Taken once: rows keep their place while open, so a toggled row stays under the pointer.
		const [initialOrder] = useState(() => orderIdentitiesForReaction(reaction, currentPersonaId, personas));
		const [recents] = useState(() =>
			personas.length >= RECENT_MIN_PERSONAS ? recentPersonaIds(PersonaStore.rankedPersonas, RECENT_LIMIT) : [],
		);

		const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
		const exists = (id: ReactionIdentityId) => id === null || personaById.has(id);
		const placed = new Set<ReactionIdentityId>([...initialOrder.reacted, ...initialOrder.rest]);
		// Personas that arrived after opening (the dialog refetches them) go at the end.
		const late = personas.filter((p) => !placed.has(p.id)).map((p) => p.id);
		const reacted = initialOrder.reacted.filter(exists);
		const rest = [...initialOrder.rest.filter(exists), ...late];

		const trimmed = query.trim();
		const matches = (id: ReactionIdentityId): boolean => {
			if (id === null) {
				const q = trimmed.toLowerCase();
				return (
					!q ||
					Boolean(currentUser?.username.toLowerCase().includes(q)) ||
					Boolean(currentUser?.displayName.toLowerCase().includes(q))
				);
			}
			const persona = personaById.get(id);
			return persona ? personaMatchesQuery(persona, trimmed) : false;
		};

		const sections: Array<Section> = [];
		if (trimmed) {
			sections.push({key: 'results', title: <Trans>Results</Trans>, ids: [...reacted, ...rest].filter(matches)});
		} else if (reacted.length > 0) {
			sections.push({key: 'reacted', title: <Trans>Reacted</Trans>, ids: reacted});
			if (rest.length > 0) sections.push({key: 'rest', title: <Trans>Everyone else</Trans>, ids: rest});
		} else {
			sections.push({key: 'all', title: null, ids: rest});
		}
		const flat = sections.flatMap((section) => section.ids);
		const showRecents = !trimmed && recents.length >= 2;

		useEffect(() => {
			rowRefs.current[activeIndex]?.scrollIntoView({block: 'nearest'});
		}, [activeIndex]);

		const toggle = (id: ReactionIdentityId) => {
			if (!PersonaStore.multiPersonaReactions) {
				reactAsOnly({i18n, channelId, messageId, emoji, reaction}, id);
				onPicked?.();
				return;
			}
			if (hasPersonaReacted(reaction, id)) {
				ReactionCommands.removeReaction(i18n, channelId, messageId, emoji, undefined, id);
			} else {
				ReactionCommands.addReaction(i18n, channelId, messageId, emoji, id);
			}
		};

		const moveActive = (delta: number, focusRow: boolean) => {
			if (flat.length === 0) return;
			const next = (activeIndex + delta + flat.length) % flat.length;
			setActiveIndex(next);
			if (focusRow) rowRefs.current[next]?.focus();
		};

		const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				moveActive(event.key === 'ArrowDown' ? 1 : -1, false);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				const id = flat[activeIndex];
				if (id !== undefined) toggle(id);
			}
		};

		const handleRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: ReactionIdentityId) => {
			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();
				toggle(id);
			} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				moveActive(event.key === 'ArrowDown' ? 1 : -1, true);
			}
		};

		const avatarSize = size === 'compact' ? 24 : 28;
		const renderAvatar = (id: ReactionIdentityId, avatarPx: number) => {
			if (!currentUser) return null;
			if (id === null) return <Avatar user={currentUser} size={avatarPx} data-flx="persona.reaction-list.avatar" />;
			return (
				<PersonaAvatar
					user={currentUser}
					persona={PersonaStore.getKnownPersona(id)}
					size={avatarPx}
					data-flx="persona.reaction-list.persona-avatar"
				/>
			);
		};

		const renderPill = (reactedNow: boolean) => (
			<span
				className={clsx(styles.pill, reactedNow && styles.pillOn)}
				aria-hidden="true"
				data-flx="persona.reactions.persona-reaction-list.render-pill.pill"
			>
				{!reactedNow && (
					<PlusIcon
						size={10}
						weight="bold"
						className={styles.pillPlus}
						data-flx="persona.reactions.persona-reaction-list.render-pill.pill-plus"
					/>
				)}
				{emojiUrl ? (
					<img
						src={emojiUrl}
						alt=""
						draggable={false}
						className={styles.pillEmoji}
						data-flx="persona.reactions.persona-reaction-list.render-pill.pill-emoji"
					/>
				) : null}
				{reactedNow && (
					<CheckIcon
						size={12}
						weight="bold"
						className={styles.pillCheck}
						data-flx="persona.reactions.persona-reaction-list.render-pill.pill-check"
					/>
				)}
			</span>
		);

		let rowIndex = 0;
		rowRefs.current = [];

		return (
			<div className={clsx(styles.root, size === 'compact' && styles.compact)} data-flx="persona.reaction-list.root">
				<div className={styles.searchWrapper} data-flx="persona.reaction-list.search-wrapper">
					<MagnifyingGlassIcon
						size={16}
						weight="bold"
						className={styles.searchIcon}
						aria-hidden="true"
						data-flx="persona.reactions.persona-reaction-list.search-icon"
					/>
					<input
						ref={inputRef}
						type="text"
						className={styles.searchInput}
						placeholder={i18n._(SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR)}
						aria-label={i18n._(SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR)}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(0);
						}}
						onKeyDown={handleSearchKeyDown}
						data-autofocus={autoFocus || undefined}
						data-flx="persona.reaction-list.search-input"
					/>
				</div>

				{showRecents && (
					<div className={styles.recentBlock} data-flx="persona.reaction-list.recent">
						<div className={styles.sectionTitle} data-flx="persona.reactions.persona-reaction-list.section-title">
							<Trans>Recent</Trans>
						</div>
						<div className={styles.recentRow} data-flx="persona.reactions.persona-reaction-list.recent-row">
							{recents.map((id) => {
								const persona = personaById.get(id);
								if (!persona) return null;
								const reactedNow = hasPersonaReacted(reaction, id);
								return (
									<button
										key={id}
										type="button"
										className={clsx(styles.recentItem, reactedNow && styles.recentItemOn)}
										aria-pressed={reactedNow}
										title={persona.name}
										onClick={() => toggle(id)}
										data-flx="persona.reaction-list.recent-item"
									>
										<span
											className={styles.recentAvatar}
											data-flx="persona.reactions.persona-reaction-list.recent-avatar"
										>
											{renderAvatar(id, 32)}
											{reactedNow && emojiUrl ? (
												<span
													className={styles.recentBadge}
													aria-hidden="true"
													data-flx="persona.reactions.persona-reaction-list.recent-badge"
												>
													<img
														src={emojiUrl}
														alt=""
														draggable={false}
														data-flx="persona.reactions.persona-reaction-list.img"
													/>
												</span>
											) : null}
										</span>
										<span className={styles.recentName} data-flx="persona.reactions.persona-reaction-list.recent-name">
											{shortName(persona)}
										</span>
									</button>
								);
							})}
						</div>
					</div>
				)}

				<div className={styles.scroller} data-flx="persona.reaction-list.scroller">
					{sections.map((section) => (
						<div
							key={section.key}
							className={styles.section}
							data-flx="persona.reactions.persona-reaction-list.section"
						>
							{section.title && (
								<div
									className={styles.sectionTitle}
									data-flx="persona.reactions.persona-reaction-list.section-title--2"
								>
									{section.title}
								</div>
							)}
							{section.ids.map((id) => {
								const index = rowIndex++;
								const persona = id === null ? null : (personaById.get(id) ?? null);
								const reactedNow = hasPersonaReacted(reaction, id);
								const isCurrent = id === currentPersonaId;
								return (
									<button
										key={id ?? 'account'}
										ref={(element) => {
											rowRefs.current[index] = element;
										}}
										type="button"
										className={clsx(styles.row, index === activeIndex && styles.rowActive)}
										aria-pressed={reactedNow}
										onClick={() => toggle(id)}
										onKeyDown={(event) => handleRowKeyDown(event, id)}
										onMouseEnter={() => setActiveIndex(index)}
										data-flx="persona.reaction-list.row"
									>
										{renderAvatar(id, avatarSize)}
										<span className={styles.details} data-flx="persona.reactions.persona-reaction-list.details">
											<span className={styles.nameRow} data-flx="persona.reactions.persona-reaction-list.name-row">
												<span className={styles.name} data-flx="persona.reaction-list.row-name">
													{id === null ? (currentUser?.displayName ?? '') : (persona?.name ?? '')}
												</span>
												{persona && (
													<PersonaTag subprofile={persona as never} data-flx="persona.reaction-list.persona-tag" />
												)}
												{id === null && (
													<span
														className={styles.accountLabel}
														data-flx="persona.reactions.persona-reaction-list.account-label"
													>
														<Trans>Account</Trans>
													</span>
												)}
												{isCurrent && (
													<span
														className={styles.currentBadge}
														data-flx="persona.reactions.persona-reaction-list.current-badge"
													>
														<Trans>Current</Trans>
													</span>
												)}
											</span>
										</span>
										{renderPill(reactedNow)}
									</button>
								);
							})}
						</div>
					))}
					{flat.length === 0 && (
						<div className={styles.empty} data-flx="persona.reactions.persona-reaction-list.empty">
							<Trans>No one matches.</Trans>
						</div>
					)}
				</div>
			</div>
		);
	},
);

PersonaReactionList.displayName = 'PersonaReactionList';

/** This message's reaction with `emoji`, kept current as reactions arrive (undefined while nobody has reacted). */
export function useOwnReactionTarget(messageId: string, emoji: ReactionEmoji) {
	return useMessageReactions(messageId).find((reaction) => emojiEquals(reaction.emoji, emoji));
}

function shortName(persona: ClientPersona): string {
	return persona.name.split(/\s+/)[0] ?? persona.name;
}
