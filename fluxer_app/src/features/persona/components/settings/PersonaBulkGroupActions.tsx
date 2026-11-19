// SPDX-License-Identifier: AGPL-3.0-or-later

import {personaErrorMessage} from '@app/features/persona/commands/PersonaCommands';
import * as PersonaGroupCommands from '@app/features/persona/commands/PersonaGroupCommands';
import {openNewPersonaGroupModal} from '@app/features/persona/components/modals/PersonaGroupNameModal';
import {PersonaGroups} from '@app/features/persona/state/PersonaGroups';
import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import * as M from '@app/features/persona/utils/PersonaGroupMessages';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {Button} from '@app/features/ui/button/Button';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import type {PersonaGroupResponse} from '@fluxer/schema/src/domains/persona/PersonaGroupSchemas';
import type {I18n} from '@lingui/core';
import {useLingui} from '@lingui/react/macro';
import {FolderMinusIcon, FolderPlusIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';

// Fork: the selection's group actions in the persona settings' action bar (tyne-chat/tyne#829):
// Add to group (or a new group with the selection) and Remove from group, each one request.

export const PersonaBulkGroupButtons = observer(
	({chosen, onDone}: {chosen: ReadonlyArray<ClientPersona>; onDone: () => void}) => {
		const {i18n} = useLingui();
		const ids = chosen.map((p) => p.id);
		const groups = PersonaGroups.groups;
		const holding = groups.filter((g) => ids.some((id) => g.persona_ids.includes(id)));
		return (
			<>
				<Button
					variant="secondary"
					small
					fitContent
					leftIcon={<FolderPlusIcon size={14} weight="bold" data-flx="persona.bulk.add-to-group-icon" />}
					onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
						ContextMenuCommands.openAboveElementBottomLeft(event, ({onClose}) => (
							<AddToGroupMenu
								i18n={i18n}
								ids={ids}
								groups={groups}
								onClose={onClose}
								onDone={onDone}
								data-flx="persona.settings.persona-bulk-group-actions.persona-bulk-group-buttons.add-to-group-menu"
							/>
						))
					}
					data-flx="persona.bulk.add-to-group"
				>
					{i18n._(M.ADD_TO_GROUP_DESCRIPTOR)}
				</Button>
				<Button
					variant="secondary"
					small
					fitContent
					disabled={holding.length === 0}
					leftIcon={<FolderMinusIcon size={14} weight="bold" data-flx="persona.bulk.remove-from-group-icon" />}
					onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
						ContextMenuCommands.openAboveElementBottomLeft(event, ({onClose}) => (
							<MenuGroup data-flx="persona.bulk.remove-from-group-menu">
								{holding.map((group) => (
									<MenuItem
										key={group.id}
										onClick={() => {
											onClose();
											void changeGroup(i18n, {groupId: group.id, remove: ids}, onDone);
										}}
										data-flx="persona.bulk.remove-from-group-item"
									>
										{group.name}
									</MenuItem>
								))}
							</MenuGroup>
						))
					}
					data-flx="persona.bulk.remove-from-group"
				>
					{i18n._(M.REMOVE_FROM_GROUP_DESCRIPTOR)}
				</Button>
			</>
		);
	},
);

const AddToGroupMenu = ({
	i18n,
	ids,
	groups,
	onClose,
	onDone,
}: {
	i18n: I18n;
	ids: ReadonlyArray<string>;
	groups: ReadonlyArray<PersonaGroupResponse>;
	onClose: () => void;
	onDone: () => void;
}) => (
	<>
		{groups.length > 0 && (
			<MenuGroup data-flx="persona.bulk.add-to-group-menu">
				{groups.map((group) => (
					<MenuItem
						key={group.id}
						// A group that holds all of them already has nothing to add.
						disabled={ids.every((id) => group.persona_ids.includes(id))}
						onClick={() => {
							onClose();
							void changeGroup(i18n, {groupId: group.id, add: ids}, onDone);
						}}
						data-flx="persona.bulk.add-to-group-item"
					>
						{group.name}
					</MenuItem>
				))}
			</MenuGroup>
		)}
		<MenuGroup data-flx="persona.bulk.add-to-new-group-menu">
			<MenuItem
				onClick={() => {
					onClose();
					openNewPersonaGroupModal(ids, onDone);
				}}
				data-flx="persona.bulk.add-to-new-group"
			>
				{i18n._(M.NEW_GROUP_MENU_DESCRIPTOR)}
			</MenuItem>
		</MenuGroup>
	</>
);

/** One request; a failure keeps the selection, so the person can try again. */
async function changeGroup(
	i18n: I18n,
	change: PersonaGroupCommands.PersonaGroupMemberChange,
	onDone: () => void,
): Promise<void> {
	try {
		await PersonaGroupCommands.changePersonaGroupMembers([change]);
	} catch (err) {
		const message = personaErrorMessage(err, i18n._(M.GROUPS_CHANGE_FAILED_DESCRIPTOR));
		if (message) ToastCommands.createToast({type: 'error', children: message});
		return;
	}
	onDone();
}
