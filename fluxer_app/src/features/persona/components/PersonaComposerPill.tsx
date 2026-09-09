// SPDX-License-Identifier: AGPL-3.0-or-later

import {Avatar} from '@app/features/ui/components/Avatar';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import Users from '@app/features/user/state/Users';
import {LockSimple} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {PersonaStore} from '../state/PersonaStore';
import styles from './PersonaComposerPill.module.css';
import {PersonaPickerSheet} from './PersonaPickerSheet';

interface PersonaComposerPillProps {
	channelId?: string;
	className?: string;
}

export const PersonaComposerPill: React.FC<PersonaComposerPillProps> = observer(({className}) => {
	const currentUser = Users.getCurrentUser();
	const personas = PersonaStore.personas;
	const activePersona = PersonaStore.activePersona;
	const isLatched = PersonaStore.isPersonaLatched && Boolean(activePersona);
	const mode = PersonaStore.activePersonaMode;

	// Hide if user has no personas configured
	if (!currentUser || personas.length === 0) {
		return null;
	}

	const avatarUrl = isLatched && activePersona ? activePersona.avatarUrl : undefined;
	const modeLabel = mode === 'last' ? 'Last Used' : mode === 'manual' ? 'Manual' : 'Off';
	const tooltipText =
		isLatched && activePersona
			? `${activePersona.name} (${modeLabel}) - Click to switch persona`
			: `Sending as @${currentUser.username} (Off) - Click to switch persona`;

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
						className={clsx(styles.pillButton, isLatched && styles.latched)}
						aria-label={tooltipText}
						data-flx="persona.persona-composer-pill.pill-button"
					>
						<Avatar
							user={currentUser}
							avatarUrl={avatarUrl}
							size={24}
							data-flx="persona.persona-composer-pill.avatar"
						/>
						{isLatched && (
							<div className={styles.latchBadge} data-flx="persona.persona-composer-pill.latch-badge">
								<LockSimple size={8} weight="bold" data-flx="persona.persona-composer-pill.lock-simple" />
							</div>
						)}
					</button>
				</FocusRing>
			</Popout>
		</div>
	);
});

export const SubprofileComposerPill = PersonaComposerPill;
