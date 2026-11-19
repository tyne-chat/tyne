// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {personaErrorMessage} from '@app/features/persona/commands/PersonaCommands';
import * as PersonaGroupCommands from '@app/features/persona/commands/PersonaGroupCommands';
import {openRenamePersonaGroupModal} from '@app/features/persona/components/modals/PersonaGroupNameModal';
import {PersonaGroupFolds} from '@app/features/persona/state/PersonaGroupFolds';
import * as M from '@app/features/persona/utils/PersonaGroupMessages';
import type {PersonaGroupSection} from '@app/features/persona/utils/PersonaGroupSections';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {Checkbox} from '@app/features/ui/checkbox/Checkbox';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import type {I18n} from '@lingui/core';
import {useLingui} from '@lingui/react/macro';
import {CaretDownIcon, DotsThreeIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import type {PersonaSelection} from './PersonaBulkSelection';
import styles from './PersonaGroupSection.module.css';

// Fork: one section of the persona settings list cut by group (tyne-chat/tyne#829): a header that
// folds it (remembered on this device), then the cards the tab draws. In Select mode the header's
// checkbox takes the whole group.

export const PersonaGroupSectionView = observer(
	({
		section,
		accountId,
		selection,
		children,
	}: {
		section: PersonaGroupSection;
		accountId: string | null;
		selection: PersonaSelection;
		children: React.ReactNode;
	}) => {
		const {i18n} = useLingui();
		const name = section.name ?? i18n._(M.NOT_IN_A_GROUP_DESCRIPTOR);
		const isGroup = section.name !== null;
		const allSelected = section.personaIds.length > 0 && section.personaIds.every((id) => selection.selected.has(id));
		const openMenu = (event: React.MouseEvent<HTMLElement>) => {
			ContextMenuCommands.openFromElementBottomRight(event, ({onClose}) => (
				<PersonaGroupMenu
					groupId={section.id}
					name={name}
					canSelectMembers={section.personaIds.length > 0}
					onSelectMembers={() => {
						PersonaGroupFolds.setFolded(accountId, section.id, false);
						selection.start(section.personaIds);
					}}
					onClose={onClose}
					data-flx="persona.group-section.menu"
				/>
			));
		};
		return (
			<section className={styles.section} aria-label={name} data-flx="persona.group-section">
				<div className={styles.header} data-flx="persona.group-section.header">
					{selection.selecting && section.personaIds.length > 0 && (
						<span className={styles.groupCheckbox} data-flx="persona.group-section.checkbox-wrap">
							<Checkbox
								checked={allSelected}
								onChange={() => selection.toggleAll(section.personaIds)}
								size="small"
								aria-label={i18n._(M.SELECT_GROUP_DESCRIPTOR, {name})}
								data-flx="persona.group-section.checkbox"
							/>
						</span>
					)}
					<FocusRing offset={-2} data-flx="persona.group-section.fold-focus-ring">
						<button
							type="button"
							className={styles.foldButton}
							aria-expanded={!section.folded}
							onClick={() => PersonaGroupFolds.toggle(accountId, section.id)}
							data-flx="persona.group-section.fold"
						>
							<CaretDownIcon
								size={14}
								weight="bold"
								className={clsx(styles.caret, section.folded && styles.caretFolded)}
								aria-hidden={true}
								data-flx="persona.group-section.caret"
							/>
							<span className={clsx(styles.name, !isGroup && styles.looseName)} data-flx="persona.group-section.name">
								{name}
							</span>
							<span className={styles.count} data-flx="persona.group-section.count">
								{section.personaIds.length}
							</span>
						</button>
					</FocusRing>
					{isGroup && !selection.selecting && (
						<FocusRing offset={-2} data-flx="persona.group-section.menu-focus-ring">
							<button
								type="button"
								className={styles.menuButton}
								aria-label={i18n._(M.GROUP_OPTIONS_DESCRIPTOR, {name})}
								onClick={openMenu}
								data-flx="persona.group-section.menu-button"
							>
								<DotsThreeIcon size={18} weight="bold" data-flx="persona.group-section.menu-icon" />
							</button>
						</FocusRing>
					)}
				</div>
				{!section.folded && children}
			</section>
		);
	},
);

const PersonaGroupMenu = ({
	groupId,
	name,
	canSelectMembers,
	onSelectMembers,
	onClose,
}: {
	groupId: string;
	name: string;
	canSelectMembers: boolean;
	onSelectMembers: () => void;
	onClose: () => void;
}) => {
	const {i18n} = useLingui();
	return (
		<MenuGroup data-flx="persona.group-section.menu.group">
			<MenuItem
				onClick={() => {
					onClose();
					openRenamePersonaGroupModal(groupId, name);
				}}
				data-flx="persona.group-section.menu.rename"
			>
				{i18n._(M.RENAME_GROUP_DESCRIPTOR)}
			</MenuItem>
			<MenuItem
				disabled={!canSelectMembers}
				onClick={() => {
					onClose();
					onSelectMembers();
				}}
				data-flx="persona.group-section.menu.select"
			>
				{i18n._(M.SELECT_GROUP_MEMBERS_DESCRIPTOR)}
			</MenuItem>
			<MenuItem
				danger
				onClick={() => {
					onClose();
					requestDeletePersonaGroup(i18n, groupId, name);
				}}
				data-flx="persona.group-section.menu.delete"
			>
				{i18n._(M.DELETE_GROUP_DESCRIPTOR)}
			</MenuItem>
		</MenuGroup>
	);
};

/** Delete asks first and says the personas stay. */
function requestDeletePersonaGroup(i18n: I18n, groupId: string, name: string): void {
	ModalCommands.push(
		modal(() => (
			<ConfirmModal
				title={i18n._(M.DELETE_GROUP_DESCRIPTOR)}
				description={i18n._(M.DELETE_GROUP_BODY_DESCRIPTOR, {name})}
				primaryText={i18n._(M.DELETE_GROUP_DESCRIPTOR)}
				primaryVariant="danger"
				onPrimary={async () => {
					try {
						await PersonaGroupCommands.deletePersonaGroup(groupId);
					} catch (err) {
						const message = personaErrorMessage(err, i18n._(M.GROUPS_CHANGE_FAILED_DESCRIPTOR));
						if (message) ToastCommands.createToast({type: 'error', children: message});
					}
				}}
				data-flx="persona.group-section.confirm-delete"
			/>
		)),
	);
}
