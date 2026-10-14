// SPDX-License-Identifier: AGPL-3.0-or-later

import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {type SegmentedTab, SegmentedTabs} from '@app/features/ui/segmented_tabs/SegmentedTabs';
import {UserSettingsModal} from '@app/features/user/components/modals/UserSettingsModal';
import Users from '@app/features/user/state/Users';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {Check, Gear, MagnifyingGlass} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useMemo, useState} from 'react';
import {fetchPersonas} from '../commands/PersonaCommands';
import {type ActivePersonaMode, PersonaStore} from '../state/PersonaStore';
import styles from './PersonaPickerSheet.module.css';

const MODE_MANUAL_DESCRIPTOR = msg({
	message: 'Manual',
	comment: 'Active persona mode manual',
});
const MODE_LAST_DESCRIPTOR = msg({
	message: 'Last used',
	comment: 'Active persona mode last used',
});
export const SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Search personas, tags, pronouns...',
	comment: 'Search placeholder in persona picker sheet',
});
const ACTIVE_PERSONA_MODE_ARIA_DESCRIPTOR = msg({
	message: 'Active persona mode',
	comment: 'Aria label for active persona mode tabs',
});

const getActivePersonaTabs = (i18n: I18n): Array<SegmentedTab<ActivePersonaMode>> => [
	{id: 'manual', label: i18n._(MODE_MANUAL_DESCRIPTOR)},
	{id: 'last', label: i18n._(MODE_LAST_DESCRIPTOR)},
];

interface PersonaPickerSheetProps {
	onClose: () => void;
	selectedPersonaId?: string;
	showModes?: boolean;
	/** The pick applies to the channel the picker was opened from, not to every channel. */
	perChannel?: boolean;
	onSelectPersona: (id: string) => void;
	onSelectAccount: () => void;
}

export const PersonaPickerSheet: React.FC<PersonaPickerSheetProps> = observer(
	({onClose, selectedPersonaId, showModes = false, perChannel = false, onSelectPersona, onSelectAccount}) => {
		const {i18n} = useLingui();
		const activePersonaTabs = useMemo(() => getActivePersonaTabs(i18n), [i18n]);

		useEffect(() => {
			void fetchPersonas();
		}, []);

		const [query, setQuery] = useState('');
		const currentUser = Users.getCurrentUser();
		const personas = PersonaStore.sortedPersonas;
		const activePersonaId = selectedPersonaId || (selectedPersonaId === '' ? null : PersonaStore.activePersonaId);
		const isLatched = selectedPersonaId ? true : PersonaStore.isPersonaLatched;
		const activePersonaMode = PersonaStore.activePersonaMode;
		const rankedPersonas = PersonaStore.rankedPersonas;

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

		const recentShelfPersonas = useMemo(() => {
			if (query.trim()) return [];
			return rankedPersonas.slice(0, 5);
		}, [rankedPersonas, query]);

		const handleSelectPersona = (id: string) => {
			onSelectPersona(id);
			onClose();
		};

		const handleResetToRoot = () => {
			onSelectAccount();
			onClose();
		};

		const handleOpenSettings = () => {
			ModalCommands.push(
				modal(() => (
					<UserSettingsModal
						initialTab="personas"
						data-flx="persona.persona-picker-sheet.handle-open-settings.user-settings-modal"
					/>
				)),
			);
			onClose();
		};

		return (
			<div className={styles.sheetContainer} data-flx="persona.picker-sheet">
				<div className={styles.searchHeader} data-flx="persona.persona-picker-sheet.search-header">
					<div className={styles.searchInputWrapper} data-flx="persona.persona-picker-sheet.search-input-wrapper">
						<MagnifyingGlass
							className={styles.searchIcon}
							size={16}
							weight="bold"
							data-flx="persona.persona-picker-sheet.search-icon"
						/>
						<input
							type="text"
							className={styles.searchInput}
							placeholder={i18n._(SEARCH_PERSONAS_PLACEHOLDER_DESCRIPTOR)}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							data-flx="persona.persona-picker-sheet.search-input.set-query.text"
						/>
					</div>
				</div>

				{showModes && (
					<div className={styles.modeTabsWrapper} data-flx="persona.persona-picker-sheet.mode-tabs-wrapper">
						<SegmentedTabs<ActivePersonaMode>
							className={styles.segmentedTabs}
							tabs={activePersonaTabs}
							selectedTab={activePersonaMode}
							onTabChange={(mode) => {
								void PersonaStore.setActivePersonaMode(mode);
							}}
							ariaLabel={i18n._(ACTIVE_PERSONA_MODE_ARIA_DESCRIPTOR)}
							data-flx="persona.persona-picker-sheet.segmented-tabs"
						/>
					</div>
				)}

				{perChannel && (
					<div className={styles.scopeNote} data-flx="persona.picker-sheet.scope-note">
						<Trans comment="Note in the persona picker when personas are remembered per channel. The persona picked here is used in the current channel only.">
							Only for this channel
						</Trans>
					</div>
				)}

				<div className={styles.listScrollArea} data-flx="persona.persona-picker-sheet.list-scroll-area">
					{/* Reset to Root Account */}
					{currentUser && (
						<div
							className={clsx(styles.personaItem, (!isLatched || !activePersonaId) && styles.active)}
							onClick={handleResetToRoot}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleResetToRoot();
								}
							}}
							role="button"
							tabIndex={0}
							data-flx="persona.persona-picker-sheet.persona-item.reset-to-root"
						>
							<Avatar user={currentUser} size={28} data-flx="persona.persona-picker-sheet.avatar" />
							<div className={styles.personaDetails} data-flx="persona.persona-picker-sheet.persona-details">
								<div className={styles.personaPrimaryRow} data-flx="persona.persona-picker-sheet.persona-primary-row">
									<span className={styles.personaName} data-flx="persona.persona-picker-sheet.persona-name">
										{currentUser.username}
									</span>
								</div>
								<span className={styles.personaPronouns} data-flx="persona.persona-picker-sheet.persona-pronouns">
									<Trans>Root Account (Default)</Trans>
								</span>
							</div>
							{!isLatched || !activePersonaId ? (
								<Check
									size={16}
									weight="bold"
									className={styles.activeCheck}
									data-flx="persona.persona-picker-sheet.active-check"
								/>
							) : null}
						</div>
					)}

					{/* Recent Personas Shelf */}
					{recentShelfPersonas.length > 0 && (
						<>
							<div className={styles.sectionTitle} data-flx="persona.persona-picker-sheet.section-title">
								<Trans>Recent Personas</Trans>
							</div>
							<div className={styles.recentShelf} data-flx="persona.persona-picker-sheet.recent-shelf">
								{recentShelfPersonas.map((p) => (
									<div
										key={p.id}
										className={styles.recentChip}
										onClick={() => handleSelectPersona(p.id)}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												handleSelectPersona(p.id);
											}
										}}
										role="button"
										tabIndex={0}
										data-flx="persona.persona-picker-sheet.recent-chip.select-persona"
									>
										{currentUser && (
											<PersonaAvatar
												user={currentUser}
												persona={PersonaStore.getKnownPersona(p.id)}
												size={18}
												data-flx="persona.persona-picker-sheet.persona-avatar"
											/>
										)}
										<span data-flx="persona.persona-picker-sheet.span">{p.name}</span>
									</div>
								))}
							</div>
						</>
					)}

					{/* Full Persona List */}
					<div className={styles.sectionTitle} data-flx="persona.persona-picker-sheet.section-title--2">
						{query.trim() ? <Trans>Search Results ({filteredPersonas.length})</Trans> : <Trans>All Personas</Trans>}
					</div>

					{filteredPersonas.length === 0 ? (
						<div className={styles.emptyNotice} data-flx="persona.persona-picker-sheet.empty-notice">
							{personas.length === 0 ? (
								<Trans>No personas configured yet. Create one in Settings.</Trans>
							) : (
								<Trans>No matching personas found.</Trans>
							)}
						</div>
					) : (
						filteredPersonas.map((p) => {
							const isThisActive = isLatched && activePersonaId === p.id;
							const primaryTag = p.persona_tags?.[0];
							const tagString = primaryTag ? `${primaryTag.prefix ?? ''}text${primaryTag.suffix ?? ''}` : undefined;

							return (
								<div
									key={p.id}
									className={clsx(styles.personaItem, isThisActive && styles.active)}
									onClick={() => handleSelectPersona(p.id)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											handleSelectPersona(p.id);
										}
									}}
									role="button"
									tabIndex={0}
									data-flx="persona.persona-picker-sheet.persona-item.select-persona"
								>
									{currentUser && (
										<PersonaAvatar
											user={currentUser}
											persona={PersonaStore.getKnownPersona(p.id)}
											size={28}
											data-flx="persona.persona-picker-sheet.persona-avatar--2"
										/>
									)}
									<div className={styles.personaDetails} data-flx="persona.persona-picker-sheet.persona-details--2">
										<div
											className={styles.personaPrimaryRow}
											data-flx="persona.persona-picker-sheet.persona-primary-row--2"
										>
											<span className={styles.personaName} data-flx="persona.persona-picker-sheet.persona-name--2">
												{p.name}
											</span>
											{PersonaStore.displayTagText && (
												<span className={styles.tagBadge} data-flx="persona.persona-picker-sheet.tag-badge">
													[{PersonaStore.displayTagText}]
												</span>
											)}
										</div>
										<div
											className={styles.personaPrimaryRow}
											data-flx="persona.persona-picker-sheet.persona-primary-row--3"
										>
											{p.pronouns && (
												<span
													className={styles.personaPronouns}
													title={p.pronouns}
													data-flx="persona.persona-picker-sheet.persona-pronouns--2"
												>
													{p.pronouns}
												</span>
											)}
											{tagString && (
												<span className={styles.tagBadge} data-flx="persona.persona-picker-sheet.tag-badge--2">
													{tagString}
												</span>
											)}
										</div>
									</div>
									{isThisActive && (
										<Check
											size={16}
											weight="bold"
											className={styles.activeCheck}
											data-flx="persona.persona-picker-sheet.active-check--2"
										/>
									)}
								</div>
							);
						})
					)}
				</div>

				<div className={styles.footer} data-flx="persona.persona-picker-sheet.footer">
					<button
						type="button"
						className={styles.settingsLink}
						onClick={handleOpenSettings}
						data-flx="persona.persona-picker-sheet.settings-link.open-settings.button"
					>
						<Gear size={14} data-flx="persona.persona-picker-sheet.gear" />
						<span data-flx="persona.persona-picker-sheet.span--2">
							<Trans>Manage Personas</Trans>
						</span>
					</button>
				</div>
			</div>
		);
	},
);
