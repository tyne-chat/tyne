// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import type {Channel} from '@app/features/channel/models/Channel';
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

/** Shown to either person in a one-on-one DM and to the owner of a group DM. */
export const SignalBarDMMenuItem = observer(({channel, onClose}: SignalBarDMMenuItemProps) => {
	const {i18n} = useLingui();
	const hasSignals = SignalBarStore.signals.length > 0;
	useEffect(() => {
		if (hasSignals) void SignalBarStore.fetchChannel(channel.id);
	}, [channel.id, hasSignals]);
	if (!hasSignals) return null;
	if (channel.isGroupDM() && channel.ownerId !== Authentication.currentUserId) return null;
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
