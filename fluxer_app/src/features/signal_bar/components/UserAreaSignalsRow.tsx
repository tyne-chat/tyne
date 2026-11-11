// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/app/components/floating/UserAreaPopout.module.css';
import {SignalsEverywherePanel} from '@app/features/signal_bar/components/SignalsEverywherePanel';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {remFromPx} from '@app/features/theme/layout/RemFromPx';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {GlobeIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';

const SIGNALS_ROW_DESCRIPTOR = msg({
	message: 'Signals',
	comment:
		'Row in your profile popout, next to your online status, that opens the panel of every chat where you have a signal on. Signals are the icons above the message box.',
});

/** The shape of the profile popout's own row button, which it hands in. */
interface UserAreaActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	icon: React.ReactNode;
	label: React.ReactNode;
	hint?: React.ReactNode;
	chevron?: boolean;
}

interface UserAreaSignalsRowProps {
	ActionButton: React.ForwardRefExoticComponent<UserAreaActionButtonProps & React.RefAttributes<HTMLButtonElement>>;
}

/**
 * "Signals" in the profile popout, after the status row: the same panel as the bar's globe. Shown
 * while the account has a signal on anywhere or Restore has something to put back.
 */
export const UserAreaSignalsRow = observer(({ActionButton}: UserAreaSignalsRowProps) => {
	const {i18n} = useLingui();
	if (SignalBarStore.signals.length === 0) return null;
	if (SignalBarStore.myChatList.length === 0 && !SignalBarStore.restoreAvailable) return null;
	return (
		<>
			<div className={styles.actionDivider} data-flx="signal-bar.user-area-signals-row.divider" />
			<Popout
				hoverDelay={0}
				hoverCloseDelay={120}
				position="right-start"
				preventInvert
				offsetMainAxis={8}
				animationType="none"
				render={({onClose}) => (
					<SignalsEverywherePanel channel={null} onClose={onClose} data-flx="signal-bar.user-area-signals-row.panel" />
				)}
				data-flx="signal-bar.user-area-signals-row.popout"
			>
				<ActionButton
					icon={<GlobeIcon size={remFromPx(16)} weight="bold" data-flx="signal-bar.user-area-signals-row.icon" />}
					label={i18n._(SIGNALS_ROW_DESCRIPTOR)}
					chevron
					data-flx="signal-bar.user-area-signals-row.button"
				/>
			</Popout>
		</>
	);
});
