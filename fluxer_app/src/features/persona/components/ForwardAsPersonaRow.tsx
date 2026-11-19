// SPDX-License-Identifier: AGPL-3.0-or-later

import Accessibility from '@app/features/accessibility/state/Accessibility';
import styles from '@app/features/persona/components/ForwardAsPersonaRow.module.css';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {SENDING_AS_TAG_DESCRIPTOR} from '@app/features/persona/components/PersonaComposerPill';
import {PersonaPickerSheet} from '@app/features/persona/components/PersonaPickerSheet';
import {normalizeSubprofile, PersonaStore} from '@app/features/persona/state/PersonaStore';
import {defaultForwardAs, type ForwardAs} from '@app/features/persona/utils/OutgoingPersona';
import {remFromPx} from '@app/features/theme/layout/RemFromPx';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {openPopout} from '@app/features/ui/popover/PopoverPopout';
import Users from '@app/features/user/state/Users';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretDownIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useCallback, useEffect, useRef, useState} from 'react';

const FORWARD_AS_DESCRIPTOR = msg({
	message: 'Forward as',
	comment: 'Label in the Forward dialog before the persona (or account) the forward is sent as.',
});
const FORWARD_AS_NAME_DESCRIPTOR = msg({
	message: 'Forward as {name}. Change',
	comment:
		'Spoken name of the button in the Forward dialog that picks who the forward is sent as. name is a persona or account name.',
});

const FORWARD_AS_POPOUT_KEY = 'forward-as-persona-picker';

/** Who the forward goes out as: the dialog's pick, else the default it shows. */
export function chosenForwardAs(picked: ForwardAs | undefined, sourceChannelId: string): ForwardAs {
	return picked !== undefined ? picked : defaultForwardAs(sourceChannelId);
}

interface ForwardAsPersonaRowProps {
	sourceChannelId: string;
	comment: string;
	picked: ForwardAs | undefined;
	onPick: (forwardAs: ForwardAs) => void;
	disabled?: boolean;
}

/**
 * "Forward as" in the Forward dialog (tyne-chat/tyne#817): who the forward and its comment go out
 * as, and a picker to change it. It shows what will be sent: a tag (or a backslash) in the comment
 * still decides, as it does in the message box.
 */
export const ForwardAsPersonaRow = observer(
	({sourceChannelId, comment, picked, onPick, disabled = false}: ForwardAsPersonaRowProps) => {
		const {i18n} = useLingui();
		const buttonRef = useRef<HTMLButtonElement | null>(null);
		const [pickerOpen, setPickerOpen] = useState(false);
		// The picker belongs to the dialog: it goes when the dialog does.
		useEffect(() => () => PopoutCommands.close(FORWARD_AS_POPOUT_KEY), []);
		const currentUser = Users.getCurrentUser();
		const chosen = chosenForwardAs(picked, sourceChannelId);
		const said = PersonaStore.matchTagOnly(comment, chosen?.id ?? null);
		let shownId: string | null = chosen?.id ?? null;
		if (said.isFromTag && said.persona) shownId = said.persona.id;
		else if (said.wasEscaped) shownId = null;
		const shownPersona = shownId != null ? PersonaStore.getKnownPersona(shownId) : null;
		const shownName =
			shownPersona?.name ??
			(shownId != null ? chosen?.name : null) ??
			currentUser?.displayName ??
			currentUser?.username ??
			'';

		const handleClick = useCallback(() => {
			const button = buttonRef.current;
			if (button == null || disabled) return;
			const popoutKey = FORWARD_AS_POPOUT_KEY;
			if (pickerOpen) {
				PopoutCommands.close(popoutKey);
				return;
			}
			openPopout(
				button,
				{
					render: ({onClose}) => (
						<PersonaPickerSheet
							onClose={onClose}
							showModes={false}
							selectedPersonaId={shownId ?? ''}
							onSelectPersona={(id) => {
								const persona = PersonaStore.personas.find((candidate) => candidate.id === id);
								if (persona != null) {
									onPick(
										normalizeSubprofile(persona, {
											display_tag_text: PersonaStore.displayTagText || null,
											display_tag_icon: PersonaStore.displayTagIcon || null,
										}),
									);
								}
							}}
							onSelectAccount={() => onPick(null)}
							data-flx="persona.forward-as.persona-picker-sheet"
						/>
					),
					position: 'top-start',
					animationType: 'none',
					onOpen: () => setPickerOpen(true),
					onClose: () => setPickerOpen(false),
					returnFocusRef: buttonRef,
				},
				popoutKey,
			);
		}, [shownId, disabled, onPick, pickerOpen]);

		if (!Accessibility.showPersonasButton || PersonaStore.personas.length === 0 || currentUser == null) {
			return null;
		}
		return (
			<div className={styles.row} data-flx="persona.forward-as.row">
				<span className={styles.label} data-flx="persona.forward-as.label">
					{i18n._(FORWARD_AS_DESCRIPTOR)}
				</span>
				<FocusRing offset={-2} data-flx="persona.forward-as.focus-ring">
					<button
						ref={buttonRef}
						type="button"
						className={styles.button}
						aria-haspopup="dialog"
						aria-expanded={pickerOpen}
						aria-label={i18n._(FORWARD_AS_NAME_DESCRIPTOR, {name: shownName})}
						title={said.isFromTag ? i18n._(SENDING_AS_TAG_DESCRIPTOR, {name: shownName}) : undefined}
						disabled={disabled}
						onClick={handleClick}
						data-flx="persona.forward-as.button"
					>
						<PersonaAvatar user={currentUser} persona={shownPersona} size={20} data-flx="persona.forward-as.avatar" />
						<span className={styles.name} data-flx="persona.forward-as.name">
							{shownName}
						</span>
						<CaretDownIcon
							className={styles.caret}
							size={remFromPx(12)}
							weight="bold"
							data-flx="persona.forward-as.caret"
						/>
					</button>
				</FocusRing>
			</div>
		);
	},
);
