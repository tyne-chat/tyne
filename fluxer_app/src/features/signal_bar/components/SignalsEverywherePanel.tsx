// SPDX-License-Identifier: AGPL-3.0-or-later

import {useHover} from '@app/features/app/hooks/useHover';
import type {Channel} from '@app/features/channel/models/Channel';
import {getDMDisplayName} from '@app/features/channel/utils/ChannelUtils';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import {
	canSetSignalIn,
	getKnownSignalChats,
	getSignalChatPlace,
	LitSignalEmoji,
	SignalChatIcon,
	SignalEmoji,
} from '@app/features/signal_bar/components/SignalChatParts';
import styles from '@app/features/signal_bar/components/SignalsEverywherePanel.module.css';
import {openSignalsRestoreModal} from '@app/features/signal_bar/components/SignalsRestoreModal';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {getSignalLabel} from '@app/features/signal_bar/utils/SignalUtils';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {Button} from '@app/features/ui/button/Button';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {ME} from '@fluxer/constants/src/AppConstants';
import type {SignalBarSignal, UserSignalRef} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import React, {useCallback, useEffect, useRef} from 'react';

const SET_EVERYWHERE_HEADING_DESCRIPTOR = msg({
	message: 'Set everywhere ({count, plural, one {# chat} other {# chats}})',
	comment:
		'Small section heading in the signals-everywhere panel, above the signals that can be set in every chat at once. {count} is how many chats a click would change.',
});
const SET_SIGNAL_EVERYWHERE_DESCRIPTOR = msg({
	message: 'Set {label} everywhere',
	comment:
		'Tooltip and accessible label on a signal in the signals-everywhere panel. Clicking it turns this signal on in every chat where you have a signal on, and your other signals there off. {label} is the signal name, such as Sleeping.',
});
const TURN_ALL_OFF_DESCRIPTOR = msg({
	message: 'Turn all off',
	comment:
		'Button in the signals-everywhere panel that turns off every signal you have on, in every chat. Keep it short.',
});
const RESTORE_ELLIPSIS_DESCRIPTOR = msg({
	message: 'Restore…',
	comment:
		'Button in the signals-everywhere panel that opens a confirmation showing how your last change everywhere would be undone. Keep the ellipsis.',
});
const TURN_OFF_CHAT_DESCRIPTOR = msg({
	message: 'Turn off signals',
	comment:
		'Right-click menu item on a chat in the signals-everywhere panel: turns off every signal you have on in that one chat or direct message.',
});
const NO_SIGNALS_ANYWHERE_DESCRIPTOR = msg({
	message: 'None of your signals are on anywhere.',
	comment:
		'Shown in the signals-everywhere panel in place of the list of chats when you have no signal on in any chat.',
});

interface SignalChatRowProps {
	channel: Channel;
	refs: ReadonlyArray<UserSignalRef>;
	columns: number;
	onOpen: (channel: Channel) => void;
	/** Arrow keys move to the next or previous row. */
	onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/** The right-click menu of a chat in the panel. */
const SignalChatRowMenu = ({channelId, onClose}: {channelId: string; onClose: () => void}) => {
	const {i18n} = useLingui();
	return (
		<MenuGroup data-flx="signal-bar.signals-everywhere-panel.row-menu.group">
			<MenuItem
				onClick={() => {
					onClose();
					void SignalBarStore.turnOffChat(channelId);
				}}
				data-flx="signal-bar.signals-everywhere-panel.row-menu.turn-off"
			>
				{i18n._(TURN_OFF_CHAT_DESCRIPTOR)}
			</MenuItem>
		</MenuGroup>
	);
};

const SignalChatRow = observer(
	React.forwardRef<HTMLButtonElement, SignalChatRowProps>(({channel, refs, columns, onOpen, onKeyDown}, ref) => {
		const {i18n} = useLingui();
		const [hoverRef, isHovering] = useHover();
		const setRef = useCallback(
			(node: HTMLButtonElement | null) => {
				hoverRef(node);
				if (typeof ref === 'function') ref(node);
				else if (ref) ref.current = node;
			},
			[hoverRef, ref],
		);
		const openMenu = useCallback(
			(event: React.MouseEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
				ContextMenuCommands.openFromEvent(event, ({onClose}) => (
					<SignalChatRowMenu
						channelId={channel.id}
						onClose={onClose}
						data-flx="signal-bar.signals-everywhere-panel.row-menu"
					/>
				));
			},
			[channel.id],
		);
		const signals = refs
			.map((item) => SignalBarStore.signals.find((signal) => signal.id === item.signal_id))
			.filter((signal): signal is SignalBarSignal => signal !== undefined);
		const name = getDMDisplayName(channel);
		const place = getSignalChatPlace(channel, i18n);
		return (
			<FocusRing offset={-2} data-flx="signal-bar.signals-everywhere-panel.row.focus-ring">
				<button
					ref={setRef}
					type="button"
					className={styles.row}
					onClick={() => onOpen(channel)}
					onKeyDown={onKeyDown}
					onContextMenu={openMenu}
					aria-label={[name, place, signals.map(getSignalLabel).join(', ')].filter(Boolean).join(', ')}
					data-flx="signal-bar.signals-everywhere-panel.row"
				>
					<span className={styles.rowIcon} data-flx="signal-bar.signals-everywhere-panel.row.icon">
						<SignalChatIcon channel={channel} size={24} data-flx="signal-bar.signals-everywhere-panel.row.chat-icon" />
					</span>
					<span className={styles.rowText} data-flx="signal-bar.signals-everywhere-panel.row.text">
						<span className={styles.rowName} data-flx="signal-bar.signals-everywhere-panel.row.name">
							{name}
						</span>
						<span className={styles.rowPlace} data-flx="signal-bar.signals-everywhere-panel.row.place">
							{place}
						</span>
					</span>
					<span
						className={styles.rowSignals}
						style={{gridTemplateColumns: `repeat(${columns}, var(--signals-everywhere-column))`}}
						aria-hidden="true"
						data-flx="signal-bar.signals-everywhere-panel.row.signals"
					>
						{signals.map((signal) => (
							<LitSignalEmoji
								key={signal.id}
								signal={signal}
								className={styles.rowEmoji}
								isHovering={isHovering}
								data-flx="signal-bar.signals-everywhere-panel.row.emoji"
							/>
						))}
					</span>
				</button>
			</FocusRing>
		);
	}),
);

interface SignalsEverywherePanelProps {
	/** The chat whose bar opened the panel; setting a signal everywhere includes it. Null from the profile popout. */
	channel: Channel | null;
	onClose: () => void;
}

/**
 * Every chat where the account has a signal on, with the actions that span them: set a ticked signal
 * everywhere, turn all off, restore. Opened from the bar's globe and from the profile popout.
 */
export const SignalsEverywherePanel = observer(({channel, onClose}: SignalsEverywherePanelProps) => {
	const {i18n} = useLingui();
	useEffect(() => {
		void SignalBarStore.fetchMyChats();
	}, []);
	const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const chats = getKnownSignalChats();
	const openChannel = channel && canSetSignalIn(channel) ? channel : null;
	const scope = chats.length + (openChannel && !chats.some((item) => item.channel.id === openChannel.id) ? 1 : 0);
	const tiles = SignalBarStore.signals.filter((signal) => signal.everywhere);
	const columns = Math.max(1, ...chats.map((item) => item.chat.signals.length));
	const busy = SignalBarStore.everywhereBusy;
	// A tile or Turn all off acts and closes the panel (Chiara, 2026-11-11); the bar shows the result.
	const setEverywhere = useCallback(
		(signalId: string) => {
			void SignalBarStore.setEverywhere(
				signalId,
				openChannel?.id ?? null,
				openChannel ? SignalBarStore.getEffectivePersonaId(openChannel.id) : null,
			);
			onClose();
		},
		[openChannel, onClose],
	);
	const openChat = useCallback(
		(target: Channel) => {
			onClose();
			NavigationCommands.selectChannel(target.guildId ?? ME, target.id);
		},
		[onClose],
	);
	const handleRowKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const rows = rowRefs.current.filter((row): row is HTMLButtonElement => row !== null);
		const index = rows.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
		event.preventDefault();
		rows[next]?.focus();
	}, []);
	return (
		<div className={styles.panel} data-flx="signal-bar.signals-everywhere-panel.panel">
			{tiles.length > 0 && (
				<>
					<div className={styles.heading} data-flx="signal-bar.signals-everywhere-panel.heading">
						{i18n._(SET_EVERYWHERE_HEADING_DESCRIPTOR, {count: scope})}
					</div>
					<div className={styles.tiles} data-flx="signal-bar.signals-everywhere-panel.tiles">
						{tiles.map((signal) => {
							const label = i18n._(SET_SIGNAL_EVERYWHERE_DESCRIPTOR, {label: getSignalLabel(signal)});
							return (
								<Tooltip key={signal.id} text={label} data-flx="signal-bar.signals-everywhere-panel.tile.tooltip">
									<FocusRing offset={-2} data-flx="signal-bar.signals-everywhere-panel.tile.focus-ring">
										<button
											type="button"
											className={styles.tile}
											disabled={busy || scope === 0}
											onClick={() => setEverywhere(signal.id)}
											aria-label={label}
											data-flx="signal-bar.signals-everywhere-panel.tile"
										>
											<SignalEmoji
												signal={signal}
												className={styles.tileEmoji}
												data-flx="signal-bar.signals-everywhere-panel.tile.emoji"
											/>
										</button>
									</FocusRing>
								</Tooltip>
							);
						})}
					</div>
				</>
			)}
			<div className={styles.actions} data-flx="signal-bar.signals-everywhere-panel.actions">
				<Button
					variant="secondary"
					small
					// Every chat the server lists, those this client cannot show included, so they can be cleared.
					disabled={busy || SignalBarStore.myChatList.length === 0}
					onClick={() => {
						void SignalBarStore.setEverywhere(null, null, null);
						onClose();
					}}
					data-flx="signal-bar.signals-everywhere-panel.turn-all-off"
				>
					{i18n._(TURN_ALL_OFF_DESCRIPTOR)}
				</Button>
				<Button
					variant="secondary"
					small
					disabled={busy || !SignalBarStore.restoreAvailable}
					onClick={() => {
						onClose();
						void openSignalsRestoreModal(i18n);
					}}
					data-flx="signal-bar.signals-everywhere-panel.restore"
				>
					{i18n._(RESTORE_ELLIPSIS_DESCRIPTOR)}
				</Button>
			</div>
			<div className={styles.divider} data-flx="signal-bar.signals-everywhere-panel.divider" />
			{chats.length === 0 ? (
				<p className={styles.empty} data-flx="signal-bar.signals-everywhere-panel.empty">
					{i18n._(NO_SIGNALS_ANYWHERE_DESCRIPTOR)}
				</p>
			) : (
				<div className={styles.list} data-flx="signal-bar.signals-everywhere-panel.list">
					{chats.map((item, index) => (
						<SignalChatRow
							key={item.channel.id}
							ref={(node) => {
								rowRefs.current[index] = node;
							}}
							channel={item.channel}
							refs={item.chat.signals}
							columns={columns}
							onOpen={openChat}
							onKeyDown={handleRowKeyDown}
							data-flx="signal-bar.signals-everywhere-panel.chat-row"
						/>
					))}
				</div>
			)}
		</div>
	);
});
