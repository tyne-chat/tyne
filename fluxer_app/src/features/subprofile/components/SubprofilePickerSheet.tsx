// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {type SegmentedTab, SegmentedTabs} from '@app/features/ui/segmented_tabs/SegmentedTabs';
import {UserSettingsModal} from '@app/features/user/components/modals/UserSettingsModal';
import Users from '@app/features/user/state/Users';
import {Check, Gear, MagnifyingGlass} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useMemo, useState} from 'react';
import {type AutoproxyMode, SubprofileStore} from '../state/SubprofileStore';
import styles from './SubprofilePickerSheet.module.css';

const AUTOPROXY_TABS: Array<SegmentedTab<AutoproxyMode>> = [
	{id: 'off', label: 'Off'},
	{id: 'manual', label: 'Manual'},
	{id: 'last', label: 'Last Used'},
];

interface SubprofilePickerSheetProps {
	onClose: () => void;
}

export const SubprofilePickerSheet: React.FC<SubprofilePickerSheetProps> = observer(({onClose}) => {
	const [query, setQuery] = useState('');
	const currentUser = Users.getCurrentUser();
	const personas = SubprofileStore.personas;
	const activePersonaId = SubprofileStore.activePersonaId;
	const isLatched = SubprofileStore.autoproxyLatched;
	const autoproxyMode = SubprofileStore.autoproxyMode;
	const rankedPersonas = SubprofileStore.rankedPersonas;

	const filteredPersonas = useMemo(() => {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return personas;
		return personas.filter((p) => {
			if (p.name.toLowerCase().includes(trimmed)) return true;
			if (p.systemName?.toLowerCase().includes(trimmed)) return true;
			if (p.pronouns?.toLowerCase().includes(trimmed)) return true;
			return (p.proxyTags ?? []).some(
				(tag) => tag.prefix?.toLowerCase().includes(trimmed) || tag.suffix?.toLowerCase().includes(trimmed),
			);
		});
	}, [personas, query]);

	const recentShelfPersonas = useMemo(() => {
		if (query.trim()) return [];
		return rankedPersonas.slice(0, 5);
	}, [rankedPersonas, query]);

	const handleSelectPersona = (id: string) => {
		void SubprofileStore.setActivePersona(id, true);
		onClose();
	};

	const handleResetToRoot = () => {
		void SubprofileStore.unlatch();
		onClose();
	};

	const handleOpenSettings = () => {
		ModalCommands.push(
			modal(() => (
				<UserSettingsModal
					initialTab="subprofiles"
					data-flx="subprofile.subprofile-picker-sheet.handle-open-settings.user-settings-modal"
				/>
			)),
		);
		onClose();
	};

	return (
		<div className={styles.sheetContainer} data-flx="subprofile.picker-sheet">
			<div className={styles.searchHeader} data-flx="subprofile.subprofile-picker-sheet.search-header">
				<div className={styles.searchInputWrapper} data-flx="subprofile.subprofile-picker-sheet.search-input-wrapper">
					<MagnifyingGlass
						className={styles.searchIcon}
						size={16}
						weight="bold"
						data-flx="subprofile.subprofile-picker-sheet.search-icon"
					/>
					<input
						type="text"
						className={styles.searchInput}
						placeholder="Search personas, tags, pronouns..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						data-flx="subprofile.subprofile-picker-sheet.search-input.set-query.text"
					/>
				</div>
			</div>

			<div className={styles.modeTabsWrapper} data-flx="subprofile.subprofile-picker-sheet.mode-tabs-wrapper">
				<SegmentedTabs<AutoproxyMode>
					tabs={AUTOPROXY_TABS}
					selectedTab={autoproxyMode}
					onTabChange={(mode) => {
						void SubprofileStore.setAutoproxyMode(mode);
					}}
					ariaLabel="Autoproxy mode"
					data-flx="subprofile.subprofile-picker-sheet.segmented-tabs"
				/>
			</div>

			<div className={styles.listScrollArea} data-flx="subprofile.subprofile-picker-sheet.list-scroll-area">
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
						data-flx="subprofile.subprofile-picker-sheet.persona-item.reset-to-root"
					>
						<Avatar user={currentUser} size={28} data-flx="subprofile.subprofile-picker-sheet.avatar" />
						<div className={styles.personaDetails} data-flx="subprofile.subprofile-picker-sheet.persona-details">
							<div
								className={styles.personaPrimaryRow}
								data-flx="subprofile.subprofile-picker-sheet.persona-primary-row"
							>
								<span className={styles.personaName} data-flx="subprofile.subprofile-picker-sheet.persona-name">
									{currentUser.username}
								</span>
							</div>
							<span className={styles.personaPronouns} data-flx="subprofile.subprofile-picker-sheet.persona-pronouns">
								Root Account (Unlatched)
							</span>
						</div>
						{!isLatched || !activePersonaId ? (
							<Check
								size={16}
								weight="bold"
								className={styles.activeCheck}
								data-flx="subprofile.subprofile-picker-sheet.active-check"
							/>
						) : null}
					</div>
				)}

				{/* Recent Fronters Shelf */}
				{recentShelfPersonas.length > 0 && (
					<>
						<div className={styles.sectionTitle} data-flx="subprofile.subprofile-picker-sheet.section-title">
							Recent Fronters
						</div>
						<div className={styles.recentShelf} data-flx="subprofile.subprofile-picker-sheet.recent-shelf">
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
									data-flx="subprofile.subprofile-picker-sheet.recent-chip.select-persona"
								>
									{currentUser && (
										<Avatar
											user={currentUser}
											avatarUrl={p.avatarUrl}
											size={18}
											data-flx="subprofile.subprofile-picker-sheet.avatar--2"
										/>
									)}
									<span data-flx="subprofile.subprofile-picker-sheet.span">{p.name}</span>
								</div>
							))}
						</div>
					</>
				)}

				{/* Full Persona List */}
				<div className={styles.sectionTitle} data-flx="subprofile.subprofile-picker-sheet.section-title--2">
					{query.trim() ? `Search Results (${filteredPersonas.length})` : 'All Personas'}
				</div>

				{filteredPersonas.length === 0 ? (
					<div className={styles.emptyNotice} data-flx="subprofile.subprofile-picker-sheet.empty-notice">
						{personas.length === 0
							? 'No personas configured yet. Create one in Settings.'
							: 'No matching personas found.'}
					</div>
				) : (
					filteredPersonas.map((p) => {
						const isThisActive = isLatched && activePersonaId === p.id;
						const primaryTag = p.proxyTags?.[0];
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
								data-flx="subprofile.subprofile-picker-sheet.persona-item.select-persona"
							>
								{currentUser && (
									<Avatar
										user={currentUser}
										avatarUrl={p.avatarUrl}
										size={28}
										data-flx="subprofile.subprofile-picker-sheet.avatar--3"
									/>
								)}
								<div className={styles.personaDetails} data-flx="subprofile.subprofile-picker-sheet.persona-details--2">
									<div
										className={styles.personaPrimaryRow}
										data-flx="subprofile.subprofile-picker-sheet.persona-primary-row--2"
									>
										<span className={styles.personaName} data-flx="subprofile.subprofile-picker-sheet.persona-name--2">
											{p.name}
										</span>
										{p.systemName && (
											<span className={styles.tagBadge} data-flx="subprofile.subprofile-picker-sheet.tag-badge">
												[{p.systemName}]
											</span>
										)}
									</div>
									<div
										className={styles.personaPrimaryRow}
										data-flx="subprofile.subprofile-picker-sheet.persona-primary-row--3"
									>
										{p.pronouns && (
											<span
												className={styles.personaPronouns}
												data-flx="subprofile.subprofile-picker-sheet.persona-pronouns--2"
											>
												{p.pronouns}
											</span>
										)}
										{tagString && (
											<span className={styles.tagBadge} data-flx="subprofile.subprofile-picker-sheet.tag-badge--2">
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
										data-flx="subprofile.subprofile-picker-sheet.active-check--2"
									/>
								)}
							</div>
						);
					})
				)}
			</div>

			<div className={styles.footer} data-flx="subprofile.subprofile-picker-sheet.footer">
				<button
					type="button"
					className={styles.settingsLink}
					onClick={handleOpenSettings}
					data-flx="subprofile.subprofile-picker-sheet.settings-link.open-settings.button"
				>
					<Gear size={14} data-flx="subprofile.subprofile-picker-sheet.gear" />
					<span data-flx="subprofile.subprofile-picker-sheet.span--2">Manage Subprofiles</span>
				</button>
			</div>
		</div>
	);
});
