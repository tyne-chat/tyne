// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import styles from '@app/features/signal_bar/components/SignalBar.module.css';
import {getKnownSignalChats} from '@app/features/signal_bar/components/SignalChatParts';
import {SignalsEverywherePanel} from '@app/features/signal_bar/components/SignalsEverywherePanel';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {GlobeIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';

const SIGNALS_EVERYWHERE_DESCRIPTOR = msg({
	message: 'Your signals everywhere · {count, plural, one {# chat} other {# chats}}',
	comment:
		'Tooltip and accessible label of the globe button at the end of the signal bar. It opens a panel listing every chat where you have a signal on. {count} is how many chats that is.',
});

/** The globe at the end of the bar: how many chats have the account's signals on, and the panel for them. */
export const SignalsEverywhereButton = observer(({channel}: {channel: Channel}) => {
	const {i18n} = useLingui();
	const count = SignalBarStore.myChats ? getKnownSignalChats().length : null;
	const label = i18n._(SIGNALS_EVERYWHERE_DESCRIPTOR, {count: count ?? 0});
	return (
		<Popout
			position="top-end"
			offsetMainAxis={8}
			animationType="none"
			tooltip={label}
			render={({onClose}) => (
				<SignalsEverywherePanel
					channel={channel}
					onClose={onClose}
					data-flx="signal-bar.signals-everywhere-button.panel"
				/>
			)}
			data-flx="signal-bar.signals-everywhere-button.popout"
		>
			<FocusRing offset={-2} data-flx="signal-bar.signals-everywhere-button.focus-ring">
				<button
					type="button"
					className={styles.globe}
					aria-label={label}
					aria-haspopup="dialog"
					data-flx="signal-bar.signals-everywhere-button.button"
				>
					<GlobeIcon size={16} weight="bold" data-flx="signal-bar.signals-everywhere-button.icon" />
					{count !== null && (
						<span
							className={clsx(styles.globeCount, count === 0 && styles.globeCountZero)}
							aria-hidden="true"
							data-flx="signal-bar.signals-everywhere-button.count"
						>
							{count}
						</span>
					)}
				</button>
			</FocusRing>
		</Popout>
	);
});
