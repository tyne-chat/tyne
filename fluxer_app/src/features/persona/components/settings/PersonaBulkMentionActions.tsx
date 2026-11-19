// SPDX-License-Identifier: AGPL-3.0-or-later

import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import * as M from '@app/features/persona/utils/PersonaBulkMessages';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItemRadio} from '@app/features/ui/action_menu/MenuItemRadio';
import {Button} from '@app/features/ui/button/Button';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import type {PersonaMentionableBy} from '@fluxer/schema/src/domains/persona/PersonaMentionableBy';
import type {I18n} from '@lingui/core';
import {useLingui} from '@lingui/react/macro';
import {AtIcon} from '@phosphor-icons/react';
import type React from 'react';
import styles from './PersonaBulkSelection.module.css';
import tabStyles from './PersonaSettingsTab.module.css';

// The selection's mention setting in the persona settings' action bar (tyne-chat/tyne#652): one
// button whose menu gives every chosen persona the same "Allow mentions by", in one request, with
// Undo. No confirmation: it only decides suggestions, never what anyone can see.

// The four stored states, Follow Visibility (null) last: the dot sits on the one every chosen persona
// has, so picking any other always changes something.
const VALUES: ReadonlyArray<PersonaMentionableBy | null> = ['everyone', 'self', 'nobody', null];
const ITEM_DESCRIPTORS = {
	everyone: M.MENTIONABLE_BY_EVERYONE_ITEM_DESCRIPTOR,
	self: M.MENTIONABLE_BY_SELF_ITEM_DESCRIPTOR,
	nobody: M.MENTIONABLE_BY_NOBODY_ITEM_DESCRIPTOR,
} as const;
const NOW_DESCRIPTORS = {
	everyone: M.NOW_MENTIONABLE_BY_EVERYONE_DESCRIPTOR,
	self: M.NOW_MENTIONABLE_BY_SELF_DESCRIPTOR,
	nobody: M.NOW_MENTIONABLE_BY_NOBODY_DESCRIPTOR,
} as const;

const storedOf = (persona: ClientPersona): PersonaMentionableBy | null => persona.mentionable_by ?? null;

export const PersonaBulkMentionButton = ({
	chosen,
	onDone,
}: {
	chosen: ReadonlyArray<ClientPersona>;
	onDone: () => void;
}) => {
	const {i18n} = useLingui();
	return (
		<Button
			variant="secondary"
			small
			fitContent
			leftIcon={<AtIcon size={14} weight="bold" data-flx="persona.bulk.mentions-icon" />}
			onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
				ContextMenuCommands.openAboveElementBottomLeft(event, ({onClose}) => (
					<MenuGroup data-flx="persona.bulk.mentions-menu">
						{VALUES.map((value) => {
							const selected = chosen.every((p) => storedOf(p) === value);
							return (
								<MenuItemRadio
									key={value ?? 'follow'}
									selected={selected}
									closeOnSelect
									data-flx="persona.bulk.mentions-item"
									onSelect={() => {
										onClose();
										if (!selected) void applyMentionableBy(i18n, chosen, value, onDone);
									}}
								>
									{i18n._(value ? ITEM_DESCRIPTORS[value] : M.MENTIONABLE_BY_FOLLOW_ITEM_DESCRIPTOR)}
								</MenuItemRadio>
							);
						})}
					</MenuGroup>
				))
			}
			data-flx="persona.bulk.mentions"
		>
			{i18n._(M.MENTIONS_BUTTON_DESCRIPTOR)}
		</Button>
	);
};

/**
 * Sends the change for the personas whose stored setting differs, then offers Undo, which puts each
 * stored value back (null included), in one request. A failure keeps the selection.
 */
export async function applyMentionableBy(
	i18n: I18n,
	chosen: ReadonlyArray<ClientPersona>,
	value: PersonaMentionableBy | null,
	onDone: () => void,
): Promise<void> {
	const changing = chosen.filter((p) => storedOf(p) !== value);
	// Nothing to change: the selection stays, as for a visibility the selection already has.
	if (changing.length === 0) return;
	const previous = changing.map((p) => ({id: p.id, mentionable_by: storedOf(p)}));
	try {
		await PersonaCommands.setPersonaMentionableBy(changing.map((p) => ({id: p.id, mentionable_by: value})));
	} catch {
		ToastCommands.createToast({type: 'error', children: i18n._(M.CHANGE_FAILED_DESCRIPTOR)});
		return;
	}
	onDone();
	ToastCommands.createToast({
		type: 'success',
		timeout: 8000,
		children: (
			<span className={styles.toastContent} data-flx="persona.bulk.mentions-toast">
				{i18n._(value ? NOW_DESCRIPTORS[value] : M.NOW_MENTIONABLE_BY_FOLLOWING_DESCRIPTOR, {count: changing.length})}
				<button
					type="button"
					className={styles.undoButton}
					onClick={() => {
						void PersonaCommands.setPersonaMentionableBy(previous).catch(() => {
							ToastCommands.createToast({type: 'error', children: i18n._(M.CHANGE_FAILED_DESCRIPTOR)});
						});
					}}
					data-flx="persona.bulk.mentions-undo"
				>
					{i18n._(M.UNDO_DESCRIPTOR)}
				</button>
			</span>
		),
	});
}

/**
 * On a settings row whose persona nobody gets in suggestions: an @ struck through. Phosphor has no
 * such icon, so a line is drawn over its @ in the same 256-unit box.
 */
export const PersonaNotMentionableIcon = () => {
	const {i18n} = useLingui();
	const label = i18n._(M.NOT_MENTIONABLE_ICON_DESCRIPTOR);
	return (
		<Tooltip text={label} position="top" data-flx="persona.settings.not-mentionable-tooltip">
			<span
				className={tabStyles.visibilityIcon}
				style={{position: 'relative'}}
				role="img"
				aria-label={label}
				data-flx="persona.settings.not-mentionable"
			>
				<AtIcon
					size={14}
					weight="bold"
					className={tabStyles.iconPrivate}
					data-flx="persona.settings.not-mentionable-at"
				/>
				<svg
					viewBox="0 0 256 256"
					className={tabStyles.iconPrivate}
					style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}
					aria-hidden="true"
					data-flx="persona.settings.not-mentionable-strike"
				>
					<line
						x1="40"
						y1="40"
						x2="216"
						y2="216"
						stroke="currentColor"
						strokeWidth="24"
						strokeLinecap="round"
						data-flx="persona.settings.persona-bulk-mention-actions.persona-not-mentionable-icon.line"
					/>
				</svg>
			</span>
		</Tooltip>
	);
};
