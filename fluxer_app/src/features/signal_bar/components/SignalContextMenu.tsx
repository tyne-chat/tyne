// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {getSignalEntryKey, getSignalEntryName} from '@app/features/signal_bar/utils/SignalUtils';
import {DeleteIcon} from '@app/features/ui/action_menu/ContextMenuIcons';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import type {SignalBarSignal} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

const NOBODY_DESCRIPTOR = msg({
	message: 'Nobody has this signal on',
	comment: 'Disabled menu entry in the signal bar right-click menu when no one has turned the signal on.',
});
const TURN_OFF_DESCRIPTOR = msg({
	message: 'Turn off {name}',
	comment:
		'Signal bar right-click menu action that turns your own signal off. {name} is the persona or account name it is currently shown as.',
});
const RESET_DESCRIPTOR = msg({
	message: 'Reset signal for everyone',
	comment: 'Destructive signal bar right-click menu action for moderators that turns the signal off for everyone.',
});

interface SignalContextMenuProps {
	channelId: string;
	guildId: string | null;
	signal: SignalBarSignal;
	canReset: boolean;
	onClose: () => void;
}

export const SignalContextMenu = observer(({channelId, guildId, signal, canReset, onClose}: SignalContextMenuProps) => {
	const {i18n} = useLingui();
	const entries = SignalBarStore.getEntries(channelId, signal.id);
	const currentUserId = Authentication.currentUserId;
	const own = entries.filter((entry) => entry.user.id === currentUserId);
	const others = entries.filter((entry) => entry.user.id !== currentUserId);
	return (
		<>
			<MenuGroup data-flx="signal-bar.signal-context-menu.members">
				{entries.length === 0 && (
					<MenuItem disabled data-flx="signal-bar.signal-context-menu.nobody">
						{i18n._(NOBODY_DESCRIPTOR)}
					</MenuItem>
				)}
				{others.map((entry) => (
					<MenuItem disabled key={getSignalEntryKey(entry)} data-flx="signal-bar.signal-context-menu.member">
						{getSignalEntryName(entry, guildId)}
					</MenuItem>
				))}
				{own.map((entry) => (
					<MenuItem
						key={getSignalEntryKey(entry)}
						onClick={() => {
							onClose();
							void SignalBarStore.deactivate(channelId, signal.id);
						}}
						data-flx="signal-bar.signal-context-menu.turn-off"
					>
						{i18n._(TURN_OFF_DESCRIPTOR, {name: getSignalEntryName(entry, guildId)})}
					</MenuItem>
				))}
			</MenuGroup>
			{canReset && entries.length > 0 && (
				<MenuGroup data-flx="signal-bar.signal-context-menu.reset-group">
					<MenuItem
						danger
						icon={<DeleteIcon data-flx="signal-bar.signal-context-menu.reset-icon" />}
						onClick={() => {
							onClose();
							void SignalBarStore.reset(channelId, signal.id);
						}}
						data-flx="signal-bar.signal-context-menu.reset"
					>
						{i18n._(RESET_DESCRIPTOR)}
					</MenuItem>
				</MenuGroup>
			)}
		</>
	);
});
