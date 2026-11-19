// SPDX-License-Identifier: AGPL-3.0-or-later

import {openNewPersonaGroupModal} from '@app/features/persona/components/modals/PersonaGroupNameModal';
import {PersonaGroups} from '@app/features/persona/state/PersonaGroups';
import * as M from '@app/features/persona/utils/PersonaGroupMessages';
import {Checkbox} from '@app/features/ui/checkbox/Checkbox';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import styles from './PersonaGroupsField.module.css';

// Fork: the persona editor's Groups (tyne-chat/tyne#829): a box per group of the account. The
// editor keeps what was ticked or unticked and sends it with Save, in one request. Shown once the
// account has a group; groups are made in the persona list, or here with New group….

export const PersonaGroupsField = observer(
	({selected, onToggle}: {selected: ReadonlyArray<string>; onToggle: (groupId: string, checked: boolean) => void}) => {
		const {i18n} = useLingui();
		const groups = PersonaGroups.groups;
		if (groups.length === 0) return null;
		return (
			<fieldset className={styles.field} data-flx="persona.persona-edit-modal.groups">
				<legend className={styles.legend} data-flx="persona.persona-edit-modal.groups-legend">
					{i18n._(M.GROUPS_DESCRIPTOR)}
				</legend>
				<div className={styles.options} data-flx="persona.persona-edit-modal.groups-options">
					{groups.map((group) => (
						<Checkbox
							key={group.id}
							checked={selected.includes(group.id)}
							onChange={(checked) => onToggle(group.id, checked)}
							size="small"
							data-flx="persona.persona-edit-modal.group-checkbox"
						>
							{group.name}
						</Checkbox>
					))}
				</div>
				<FocusRing offset={-2} data-flx="persona.persona-edit-modal.new-group-focus-ring">
					<button
						type="button"
						className={styles.newGroup}
						onClick={() => openNewPersonaGroupModal([], (groupId) => onToggle(groupId, true))}
						data-flx="persona.persona-edit-modal.new-group"
					>
						{i18n._(M.NEW_GROUP_MENU_DESCRIPTOR)}
					</button>
				</FocusRing>
			</fieldset>
		);
	},
);
