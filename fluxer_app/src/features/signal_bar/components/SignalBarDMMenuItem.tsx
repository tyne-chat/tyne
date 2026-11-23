// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import {isSystemDmChannel} from '@app/features/channel/utils/ChannelUtils';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useEffect} from 'react';

const TURN_ON_DESCRIPTOR = msg({
	message: 'Turn on signal bar',
	comment: 'Direct message right-click menu action that shows the signal bar above the message box in this DM.',
});
const TURN_OFF_DESCRIPTOR = msg({
	message: 'Turn off signal bar',
	comment: 'Direct message right-click menu action that hides the signal bar in this DM and clears its signals.',
});

interface SignalBarDMMenuItemProps {
	channel: Channel;
	onClose: () => void;
}

/**
 * Shown to everyone in a one-on-one or group DM, but never in the system DM: nobody writes there, so it
 * has no signal bar (tyne-chat/tyne#743).
 */
export const SignalBarDMMenuItem = observer(({channel, onClose}: SignalBarDMMenuItemProps) => {
	const {i18n} = useLingui();
	const shown = SignalBarStore.signals.length > 0 && !isSystemDmChannel(channel);
	useEffect(() => {
		if (shown) void SignalBarStore.fetchChannel(channel.id);
	}, [channel.id, shown]);
	if (!shown) return null;
	const enabled = SignalBarStore.isEnabled(channel.id);
	return (
		<MenuItem
			onClick={() => {
				onClose();
				void SignalBarStore.setDmEnabled(channel.id, !enabled);
			}}
			data-flx="signal-bar.signal-bar-dm-menu-item.menu-item"
		>
			{i18n._(enabled ? TURN_OFF_DESCRIPTOR : TURN_ON_DESCRIPTOR)}
		</MenuItem>
	);
});
