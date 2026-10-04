// SPDX-License-Identifier: AGPL-3.0-or-later

import {DragItemType} from '@app/features/app/components/layout/types/DndTypes';
import {useHover} from '@app/features/app/hooks/useHover';
import {useShouldAnimate} from '@app/features/app/hooks/useShouldAnimate';
import Authentication from '@app/features/auth/state/Authentication';
import type {Channel} from '@app/features/channel/models/Channel';
import Permission from '@app/features/permissions/state/Permission';
import styles from '@app/features/signal_bar/components/SignalBar.module.css';
import {SignalContextMenu} from '@app/features/signal_bar/components/SignalContextMenu';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {
	getSignalEntryKey,
	getSignalEntryName,
	getSignalImageUrl,
	getSignalLabel,
	moveSignal,
} from '@app/features/signal_bar/utils/SignalUtils';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import Users from '@app/features/user/state/Users';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {SignalBarSignal} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretDownIcon, CaretUpIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useDrag, useDrop} from 'react-dnd';

const SIGNAL_BAR_DESCRIPTOR = msg({
	message: 'Signal bar',
	comment: 'Accessible label for the row of toggleable signal icons above the message box.',
});
const SHOW_SIGNAL_BAR_DESCRIPTOR = msg({
	message: 'Show signal bar',
	comment: 'Tooltip for the small arrow button that expands the collapsed signal bar above the message box.',
});
const HIDE_SIGNAL_BAR_DESCRIPTOR = msg({
	message: 'Hide signal bar',
	comment: 'Tooltip for the small arrow button that collapses the signal bar above the message box.',
});
const SIGNAL_WITH_NAMES_DESCRIPTOR = msg({
	message: '{label}: {names}',
	comment:
		'Accessible label on a lit signal icon. {label} is the signal name such as Reading, {names} is a comma-separated list of the people who turned it on.',
});

const MAX_BADGES = 3;
const BADGE_SIZE = 16;

interface SignalDragItem {
	id: string;
	index: number;
}

interface SignalButtonProps {
	channel: Channel;
	signal: SignalBarSignal;
	index: number;
	canToggle: boolean;
	canReset: boolean;
	canManage: boolean;
	onMove: (from: number, to: number) => void;
	onCommit: () => void;
}

const SignalButton = observer(
	({channel, signal, index, canToggle, canReset, canManage, onMove, onCommit}: SignalButtonProps) => {
		const {i18n} = useLingui();
		const guildId = channel.guildId ?? null;
		const entries = SignalBarStore.getEntries(channel.id, signal.id);
		const lit = entries.length > 0;
		const currentUserId = Authentication.currentUserId;
		const mine = entries.some((entry) => entry.user.id === currentUserId);
		const [hoverRef, isHovering] = useHover();
		const shouldAnimate = useShouldAnimate({kind: 'emoji', isAnimated: signal.animated, isHovering});
		const imageUrl = getSignalImageUrl(signal, lit && shouldAnimate);
		const label = getSignalLabel(signal);
		const names = entries.map((entry) => getSignalEntryName(entry, guildId));
		const ariaLabel = lit ? i18n._(SIGNAL_WITH_NAMES_DESCRIPTOR, {label, names: names.join(', ')}) : label;
		const tooltip = lit
			? () => (
					<div className={styles.tooltip} data-flx="signal-bar.signal-button.tooltip-content">
						<div className={styles.tooltipLabel} data-flx="signal-bar.signal-button.tooltip-label">
							{label}
						</div>
						{entries.map((entry, i) => (
							<div key={entry.user.id} data-flx="signal-bar.signal-button.tooltip-name">
								{names[i]}
							</div>
						))}
					</div>
				)
			: label;
		const buttonRef = useRef<HTMLButtonElement | null>(null);
		const [{isDragging}, dragRef] = useDrag(
			() => ({
				type: DragItemType.SIGNAL,
				item: (): SignalDragItem => ({id: signal.id, index}),
				canDrag: () => canManage,
				collect: (monitor) => ({isDragging: monitor.isDragging()}),
				end: () => onCommit(),
			}),
			[signal.id, index, canManage, onCommit],
		);
		const [, dropRef] = useDrop(
			() => ({
				accept: DragItemType.SIGNAL,
				hover: (item: SignalDragItem) => {
					if (item.index === index) return;
					onMove(item.index, index);
					item.index = index;
				},
			}),
			[index, onMove],
		);
		const setRef = useCallback(
			(node: HTMLButtonElement | null) => {
				buttonRef.current = node;
				hoverRef(node);
				dragRef(dropRef(node));
			},
			[hoverRef, dragRef, dropRef],
		);
		const openMenu = useCallback(
			(event: React.MouseEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
				ContextMenuCommands.openFromEvent(event, ({onClose}) => (
					<SignalContextMenu
						channelId={channel.id}
						guildId={guildId}
						signal={signal}
						canReset={canReset}
						onClose={onClose}
						data-flx="signal-bar.signal-button.signal-context-menu"
					/>
				));
			},
			[channel.id, guildId, signal, canReset],
		);
		const suppressMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
			event.preventDefault();
		}, []);
		const handleClick = useCallback(() => {
			if (!canToggle) return;
			if (mine) {
				void SignalBarStore.deactivate(channel.id, signal.id);
			} else {
				void SignalBarStore.activate(channel.id, signal.id, SignalBarStore.getEffectivePersonaId(channel.id));
			}
		}, [canToggle, mine, channel.id, signal.id]);
		return (
			<Tooltip text={tooltip} data-flx="signal-bar.signal-button.tooltip">
				<button
					ref={setRef}
					type="button"
					className={clsx(
						styles.signal,
						!canToggle && styles.signalReadOnly,
						canManage && styles.signalDraggable,
						isDragging && styles.signalDragging,
					)}
					aria-label={ariaLabel}
					aria-pressed={mine}
					onClick={handleClick}
					onContextMenu={canReset ? openMenu : suppressMenu}
					data-flx="signal-bar.signal-button.button"
				>
					{imageUrl ? (
						<img
							className={clsx(styles.emoji, !lit && styles.emojiOff)}
							src={imageUrl}
							alt=""
							draggable={false}
							data-flx="signal-bar.signal-button.emoji"
						/>
					) : (
						<span className={clsx(styles.emojiText, !lit && styles.emojiOff)} data-flx="signal-bar.signal-button.span">
							{signal.emoji_name}
						</span>
					)}
					{lit && (
						<span className={styles.badges} data-flx="signal-bar.signal-button.badges">
							{entries.slice(0, MAX_BADGES).map((entry) => {
								const user = Users.getUser(entry.user.id);
								if (!user) return null;
								return (
									<span
										className={styles.badge}
										key={getSignalEntryKey(entry)}
										data-flx="signal-bar.signal-button.badge"
									>
										<Avatar
											user={user}
											size={BADGE_SIZE}
											avatarUrl={entry.subprofile?.avatar ?? undefined}
											guildId={guildId ?? undefined}
											disableStatusTooltip={true}
											data-flx="signal-bar.signal-button.avatar"
										/>
									</span>
								);
							})}
							{entries.length > MAX_BADGES && (
								<span className={styles.more} data-flx="signal-bar.signal-button.more">
									+{entries.length - MAX_BADGES}
								</span>
							)}
						</span>
					)}
				</button>
			</Tooltip>
		);
	},
);

interface SignalBarProps {
	channel: Channel;
	attached?: boolean;
}

export const SignalBar = observer(({channel, attached = false}: SignalBarProps) => {
	const {i18n} = useLingui();
	const {signals, collapsed, canManage, epoch, version} = SignalBarStore;
	const hasSignals = signals.length > 0;
	const [draft, setDraft] = useState<ReadonlyArray<SignalBarSignal> | null>(null);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	useEffect(() => {
		if (version < 0) void SignalBarStore.fetchConfig();
	}, [version]);
	useEffect(() => {
		if (hasSignals) void SignalBarStore.fetchChannel(channel.id);
	}, [channel.id, hasSignals, epoch]);
	const handleMove = useCallback((from: number, to: number) => {
		setDraft((current) => moveSignal(current ?? SignalBarStore.signals, from, to));
	}, []);
	const handleCommit = useCallback(() => {
		const next = draftRef.current;
		if (!next) return;
		void SignalBarStore.saveSignals(next).finally(() => setDraft(null));
	}, []);
	if (!hasSignals || !SignalBarStore.isEnabled(channel.id)) return null;
	const isGuildChannel = channel.guildId != null;
	const canToggle = !isGuildChannel || Permission.can(Permissions.SEND_MESSAGES, channel);
	const canReset = isGuildChannel
		? Permission.can(Permissions.MANAGE_GUILD, channel)
		: !channel.isGroupDM() || channel.ownerId === Authentication.currentUserId;
	const toggleLabel = i18n._(collapsed ? SHOW_SIGNAL_BAR_DESCRIPTOR : HIDE_SIGNAL_BAR_DESCRIPTOR);
	return (
		<div
			className={clsx(
				styles.bar,
				attached ? styles.barAttached : styles.barStandalone,
				collapsed && styles.barCollapsed,
			)}
			role="toolbar"
			aria-label={i18n._(SIGNAL_BAR_DESCRIPTOR)}
			data-flx="signal-bar.signal-bar.bar"
		>
			{!collapsed && (
				<div className={styles.signals} data-flx="signal-bar.signal-bar.signals">
					{(draft ?? signals).map((signal, index) => (
						<SignalButton
							key={signal.id}
							channel={channel}
							signal={signal}
							index={index}
							canToggle={canToggle}
							canReset={canReset}
							canManage={canManage}
							onMove={handleMove}
							onCommit={handleCommit}
							data-flx="signal-bar.signal-bar.signal-button"
						/>
					))}
				</div>
			)}
			<Tooltip text={toggleLabel} data-flx="signal-bar.signal-bar.tooltip">
				<button
					type="button"
					className={styles.caret}
					aria-label={toggleLabel}
					aria-expanded={!collapsed}
					onClick={() => SignalBarStore.setCollapsed(!collapsed)}
					data-flx="signal-bar.signal-bar.caret"
				>
					{collapsed ? (
						<CaretUpIcon size={14} weight="bold" data-flx="signal-bar.signal-bar.caret-up-icon" />
					) : (
						<CaretDownIcon size={14} weight="bold" data-flx="signal-bar.signal-bar.caret-down-icon" />
					)}
				</button>
			</Tooltip>
		</div>
	);
});
