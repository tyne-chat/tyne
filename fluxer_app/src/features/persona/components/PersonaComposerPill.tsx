// SPDX-License-Identifier: AGPL-3.0-or-later

import {Avatar} from '@app/features/ui/components/Avatar';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import Users from '@app/features/user/state/Users';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {LockSimple} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {PersonaStore} from '../state/PersonaStore';
import styles from './PersonaComposerPill.module.css';
import {PersonaPickerSheet} from './PersonaPickerSheet';

const MODE_OFF_DESCRIPTOR = msg({
	message: 'Off',
	comment: 'Active persona mode off',
});
const MODE_MANUAL_DESCRIPTOR = msg({
	message: 'Manual',
	comment: 'Active persona mode manual',
});
const MODE_LAST_DESCRIPTOR = msg({
	message: 'Last Used',
	comment: 'Active persona mode last used',
});
const SENDING_AS_TAG_DESCRIPTOR = msg({
	message: 'Sending as {name} (Matched by tag) - Click to switch persona',
	comment: 'Tooltip when sending as a persona matched by persona tag',
});
const SENDING_AS_LATCHED_DESCRIPTOR = msg({
	message: '{name} ({mode}) - Click to switch persona',
	comment: 'Tooltip when sending as a latched persona',
});
const SENDING_AS_ROOT_DESCRIPTOR = msg({
	message: 'Sending as @{username} ({mode}) - Click to switch persona',
	comment: 'Tooltip when sending as root account with persona mode active',
});

interface PersonaComposerPillProps {
	channelId?: string;
	className?: string;
	text?: string;
	hasAttachments?: boolean;
}

export const PersonaComposerPill: React.FC<PersonaComposerPillProps> = observer(
	({className, text = '', hasAttachments = false}) => {
		const {i18n} = useLingui();
		const currentUser = Users.getCurrentUser();
		const personas = PersonaStore.personas;
		const activePersona = PersonaStore.activePersona;
		const isLatched = PersonaStore.isPersonaLatched && Boolean(activePersona);
		const mode = PersonaStore.activePersonaMode;

		// Hide if user has no personas configured
		if (!currentUser || personas.length === 0) {
			return null;
		}

		const {persona: effectivePersona, isFromTag} = PersonaStore.getEffectivePersonaForText(text, hasAttachments);

		const avatarUrl = effectivePersona
			? (effectivePersona.avatarUrl ?? effectivePersona.avatar_url ?? undefined)
			: undefined;
		const modeLabel =
			mode === 'last'
				? i18n._(MODE_LAST_DESCRIPTOR)
				: mode === 'manual'
					? i18n._(MODE_MANUAL_DESCRIPTOR)
					: i18n._(MODE_OFF_DESCRIPTOR);

		let tooltipText: string;
		if (isFromTag && effectivePersona) {
			tooltipText = i18n._(SENDING_AS_TAG_DESCRIPTOR, {name: effectivePersona.name});
		} else if (isLatched && activePersona) {
			tooltipText = i18n._(SENDING_AS_LATCHED_DESCRIPTOR, {name: activePersona.name, mode: modeLabel});
		} else {
			tooltipText = i18n._(SENDING_AS_ROOT_DESCRIPTOR, {username: currentUser.username, mode: modeLabel});
		}

		return (
			<div className={clsx(styles.pillContainer, className)} data-flx="persona.composer-pill">
				<Popout
					position="top-start"
					offsetMainAxis={8}
					tooltip={tooltipText}
					tooltipPosition="top"
					render={({onClose}) => (
						<PersonaPickerSheet
							onClose={onClose}
							showModes={true}
							onSelectPersona={(id) => {
								void PersonaStore.setActivePersona(id, true);
							}}
							onSelectAccount={() => {
								void PersonaStore.unlatch();
							}}
							data-flx="persona.persona-composer-pill.persona-picker-sheet"
						/>
					)}
					data-flx="persona.persona-composer-pill.popout"
				>
					<FocusRing offset={-2} data-flx="persona.persona-composer-pill.focus-ring">
						<button
							type="button"
							className={clsx(
								styles.pillButton,
								isLatched && !isFromTag && styles.latched,
								isFromTag && styles.tagMatched,
							)}
							aria-label={tooltipText}
							data-flx="persona.persona-composer-pill.pill-button"
						>
							<Avatar
								user={currentUser}
								avatarUrl={avatarUrl}
								size={24}
								data-flx="persona.persona-composer-pill.avatar"
							/>
							{isLatched && !isFromTag && (
								<div className={styles.latchBadge} data-flx="persona.persona-composer-pill.latch-badge">
									<LockSimple size={8} weight="bold" data-flx="persona.persona-composer-pill.lock-simple" />
								</div>
							)}
						</button>
					</FocusRing>
				</Popout>
			</div>
		);
	},
);

export const SubprofileComposerPill = PersonaComposerPill;
