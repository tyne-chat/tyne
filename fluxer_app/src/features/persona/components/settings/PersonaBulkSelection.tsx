// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import * as M from '@app/features/persona/utils/PersonaBulkMessages';
import {Button} from '@app/features/ui/button/Button';
import {Checkbox} from '@app/features/ui/checkbox/Checkbox';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import type {PersonaVisibility} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {I18n} from '@lingui/core';
import {Trans, useLingui} from '@lingui/react/macro';
import {EyeSlashIcon, GlobeSimpleIcon, LockSimpleIcon, TrashIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import {useCallback, useMemo, useState} from 'react';
import styles from './PersonaBulkSelection.module.css';

// Select many personas in settings and change their visibility or delete them in one request
// (tyne-chat/tyne#542). The tab keeps the selection; this file draws the chips, the selection
// header and the action bar, and runs the confirmations, the requests and Undo.

export type PersonaVisibilityFilter = 'all' | PersonaVisibility;

const VISIBILITIES: ReadonlyArray<PersonaVisibility> = ['public', 'unlisted', 'private'];

export function visibilityOf(persona: ClientPersona): PersonaVisibility {
	return persona.visibility ?? 'unlisted';
}

export interface PersonaSelection {
	selecting: boolean;
	selected: ReadonlySet<string>;
	start: (ids?: ReadonlyArray<string>) => void;
	stop: () => void;
	toggle: (id: string) => void;
	/** Selects these ids, or clears them all when every one of them is selected already. */
	toggleAll: (ids: ReadonlyArray<string>) => void;
}

/** The selection, which survives changing the chip or the search; ids no longer in the list drop out. */
export function usePersonaSelection(personas: ReadonlyArray<ClientPersona>): PersonaSelection {
	const [selecting, setSelecting] = useState(false);
	const [rawSelected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const selected = useMemo(() => {
		const live = new Set(personas.map((p) => p.id));
		return new Set(Array.from(rawSelected).filter((id) => live.has(id)));
	}, [personas, rawSelected]);
	const start = useCallback((ids: ReadonlyArray<string> = []) => {
		setSelecting(true);
		setSelected(new Set(ids));
	}, []);
	const stop = useCallback(() => {
		setSelecting(false);
		setSelected(new Set());
	}, []);
	const toggle = useCallback((id: string) => {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);
	const toggleAll = useCallback((ids: ReadonlyArray<string>) => {
		setSelected((current) => {
			const next = new Set(current);
			const all = ids.length > 0 && ids.every((id) => next.has(id));
			for (const id of ids) {
				if (all) next.delete(id);
				else next.add(id);
			}
			return next;
		});
	}, []);
	return {selecting, selected, start, stop, toggle, toggleAll};
}

const FILTER_LABELS: Record<PersonaVisibilityFilter, typeof M.FILTER_ALL_DESCRIPTOR> = {
	all: M.FILTER_ALL_DESCRIPTOR,
	public: M.FILTER_PUBLIC_DESCRIPTOR,
	unlisted: M.FILTER_UNLISTED_DESCRIPTOR,
	private: M.FILTER_PRIVATE_DESCRIPTOR,
};

/** All, Public, Unlisted and Private, each with how many personas it holds. */
export const PersonaVisibilityChips = observer(
	({
		personas,
		value,
		onChange,
	}: {
		personas: ReadonlyArray<ClientPersona>;
		value: PersonaVisibilityFilter;
		onChange: (value: PersonaVisibilityFilter) => void;
	}) => {
		const {i18n} = useLingui();
		const counts: Record<PersonaVisibilityFilter, number> = {all: personas.length, public: 0, unlisted: 0, private: 0};
		for (const p of personas) counts[visibilityOf(p)]++;
		return (
			<div
				role="group"
				aria-label={i18n._(M.FILTER_BY_VISIBILITY_DESCRIPTOR)}
				className={styles.chips}
				data-flx="persona.settings.persona-bulk-selection.persona-visibility-chips.chips"
			>
				{(['all', ...VISIBILITIES] as const).map((filter) => (
					<button
						key={filter}
						type="button"
						aria-pressed={value === filter}
						className={clsx(styles.chip, value === filter && styles.chipOn)}
						onClick={() => onChange(filter)}
						data-flx="persona.bulk.chip"
					>
						{i18n._(FILTER_LABELS[filter])}
						<span className={styles.chipCount} data-flx="persona.bulk.chip-count">
							{counts[filter]}
						</span>
					</button>
				))}
			</div>
		);
	},
);

/** "Select all" for what the search and chip show, the count, and Cancel. */
export const PersonaSelectionHeader = observer(
	({selection, shownIds}: {selection: PersonaSelection; shownIds: ReadonlyArray<string>}) => {
		const {i18n} = useLingui();
		const shownSelected = shownIds.filter((id) => selection.selected.has(id)).length;
		const allShown = shownIds.length > 0 && shownSelected === shownIds.length;
		return (
			<div className={styles.selectionHeader} data-flx="persona.bulk.selection-header">
				<Checkbox
					checked={allShown}
					disabled={shownIds.length === 0}
					onChange={() => selection.toggleAll(shownIds)}
					size="small"
					data-flx="persona.bulk.select-all"
				>
					<span className={styles.selectAllLabel} data-flx="persona.bulk.select-all-label">
						{i18n._(M.SELECT_ALL_DESCRIPTOR)}
					</span>
				</Checkbox>
				<span className={styles.spacer} data-flx="persona.bulk.spacer" />
				<span className={styles.selectedCount} aria-live="polite" data-flx="persona.bulk.selected-count">
					{i18n._(M.SELECTED_COUNT_DESCRIPTOR, {count: selection.selected.size})}
				</span>
				<button type="button" className={styles.linkButton} onClick={selection.stop} data-flx="persona.bulk.cancel">
					<Trans>Cancel</Trans>
				</button>
			</div>
		);
	},
);

/**
 * A persona card's checkbox. The card toggles on click too, so the click stops here: otherwise one
 * click on the box toggles twice and nothing changes (tyne-chat/tyne#560).
 */
export const PersonaCardCheckbox = ({
	checked,
	label,
	onToggle,
}: {
	checked: boolean;
	label: string;
	onToggle: () => void;
}) => (
	// biome-ignore lint/a11y/noStaticElementInteractions: only keeps the checkbox's clicks from also reaching the card.
	// biome-ignore lint/a11y/useKeyWithClickEvents: only keeps the checkbox's clicks from also reaching the card.
	<span
		className={styles.cardCheckbox}
		onClick={(e) => e.stopPropagation()}
		data-flx="persona.bulk.card-checkbox.stop-propagation"
	>
		<Checkbox
			checked={checked}
			onChange={onToggle}
			size="small"
			aria-label={label}
			data-flx="persona.settings.persona-settings-tab.select-checkbox"
		/>
	</span>
);

const VISIBILITY_ICONS = {public: GlobeSimpleIcon, unlisted: EyeSlashIcon, private: LockSimpleIcon} as const;
const VISIBILITY_ICON_CLASSES = {
	public: styles.iconPublic,
	unlisted: styles.iconUnlisted,
	private: styles.iconPrivate,
} as const;
const MAKE_DESCRIPTORS = {
	public: M.MAKE_PUBLIC_DESCRIPTOR,
	unlisted: M.MAKE_UNLISTED_DESCRIPTOR,
	private: M.MAKE_PRIVATE_DESCRIPTOR,
} as const;

/** The bar under a non-empty selection: Make public, unlisted or private, and Delete. */
export const PersonaBulkActionBar = observer(
	({selection, personas}: {selection: PersonaSelection; personas: ReadonlyArray<ClientPersona>}) => {
		const {i18n} = useLingui();
		const chosen = personas.filter((p) => selection.selected.has(p.id));
		if (!selection.selecting || chosen.length === 0) return null;
		return (
			<div className={styles.actionBar} role="toolbar" data-flx="persona.bulk.action-bar">
				<span className={styles.actionCount} data-flx="persona.bulk.action-count">
					{i18n._(M.SELECTED_COUNT_DESCRIPTOR, {count: chosen.length})}
				</span>
				{VISIBILITIES.map((visibility) => {
					const Icon = VISIBILITY_ICONS[visibility];
					return (
						<Button
							key={visibility}
							variant="secondary"
							small
							fitContent
							disabled={chosen.every((p) => visibilityOf(p) === visibility)}
							leftIcon={
								<Icon
									size={14}
									weight="bold"
									className={VISIBILITY_ICON_CLASSES[visibility]}
									data-flx="persona.bulk.icon"
								/>
							}
							onClick={() => requestVisibility(i18n, chosen, visibility, selection.stop)}
							data-flx="persona.bulk.make-visibility"
						>
							{i18n._(MAKE_DESCRIPTORS[visibility])}
						</Button>
					);
				})}
				<Button
					variant="danger"
					small
					fitContent
					leftIcon={<TrashIcon size={14} weight="bold" data-flx="persona.bulk.delete-icon" />}
					onClick={() => requestDelete(i18n, chosen, selection.stop)}
					data-flx="persona.bulk.delete"
				>
					<Trans>Delete</Trans>
				</Button>
				<span className={styles.spacer} data-flx="persona.bulk.bar-spacer" />
				<button type="button" className={styles.linkButton} onClick={selection.stop} data-flx="persona.bulk.bar-cancel">
					<Trans>Cancel</Trans>
				</button>
			</div>
		);
	},
);

const NOW_DESCRIPTORS = {
	public: M.NOW_PUBLIC_DESCRIPTOR,
	unlisted: M.NOW_UNLISTED_DESCRIPTOR,
	private: M.NOW_PRIVATE_DESCRIPTOR,
} as const;

/** Public and private ask first, as they change what others see the most; unlisted applies at once. */
export function requestVisibility(
	i18n: I18n,
	chosen: ReadonlyArray<ClientPersona>,
	visibility: PersonaVisibility,
	onDone: () => void,
): void {
	const changing = chosen.filter((p) => visibilityOf(p) !== visibility);
	if (changing.length === 0) return;
	if (visibility === 'unlisted') {
		void applyVisibility(i18n, changing, visibility, onDone);
		return;
	}
	const isPublic = visibility === 'public';
	ModalCommands.push(
		modal(() => (
			<ConfirmModal
				title={i18n._(isPublic ? M.CONFIRM_PUBLIC_TITLE_DESCRIPTOR : M.CONFIRM_PRIVATE_TITLE_DESCRIPTOR, {
					count: changing.length,
				})}
				description={i18n._(isPublic ? M.CONFIRM_PUBLIC_BODY_DESCRIPTOR : M.CONFIRM_PRIVATE_BODY_DESCRIPTOR)}
				primaryText={i18n._(MAKE_DESCRIPTORS[visibility])}
				onPrimary={() => applyVisibility(i18n, changing, visibility, onDone)}
				data-flx="persona.bulk.confirm-visibility"
			/>
		)),
	);
}

/**
 * Sends the change, then offers Undo, which puts each persona back to what it was, in one request.
 * A failure keeps the selection, so the person can try again.
 */
export async function applyVisibility(
	i18n: I18n,
	changing: ReadonlyArray<ClientPersona>,
	visibility: PersonaVisibility,
	onDone: () => void,
): Promise<void> {
	const previous = changing.map((p) => ({id: p.id, visibility: visibilityOf(p)}));
	try {
		await PersonaCommands.setPersonaVisibilities(changing.map((p) => ({id: p.id, visibility})));
	} catch {
		ToastCommands.createToast({type: 'error', children: i18n._(M.CHANGE_FAILED_DESCRIPTOR)});
		return;
	}
	onDone();
	ToastCommands.createToast({
		type: 'success',
		timeout: 8000,
		children: (
			<span className={styles.toastContent} data-flx="persona.bulk.toast">
				{i18n._(NOW_DESCRIPTORS[visibility], {count: changing.length})}
				<button
					type="button"
					className={styles.undoButton}
					onClick={() => {
						void PersonaCommands.setPersonaVisibilities(previous).catch(() => {
							ToastCommands.createToast({type: 'error', children: i18n._(M.CHANGE_FAILED_DESCRIPTOR)});
						});
					}}
					data-flx="persona.bulk.undo"
				>
					{i18n._(M.UNDO_DESCRIPTOR)}
				</button>
			</span>
		),
	});
}

/** Delete asks first, in red, and says it cannot be undone; there is no Undo afterwards. */
export function requestDelete(i18n: I18n, chosen: ReadonlyArray<ClientPersona>, onDone: () => void): void {
	const ids = chosen.map((p) => p.id);
	ModalCommands.push(
		modal(() => (
			<ConfirmModal
				title={i18n._(M.CONFIRM_DELETE_TITLE_DESCRIPTOR, {count: ids.length})}
				description={i18n._(M.CONFIRM_DELETE_BODY_DESCRIPTOR)}
				primaryText={<Trans>Delete</Trans>}
				primaryVariant="danger"
				onPrimary={async () => {
					try {
						await PersonaCommands.deletePersonas(ids);
					} catch {
						ToastCommands.createToast({type: 'error', children: i18n._(M.CHANGE_FAILED_DESCRIPTOR)});
						return;
					}
					onDone();
					ToastCommands.createToast({type: 'success', children: i18n._(M.DELETED_DESCRIPTOR, {count: ids.length})});
				}}
				data-flx="persona.bulk.confirm-delete"
			/>
		)),
	);
}
