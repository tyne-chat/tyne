// SPDX-License-Identifier: AGPL-3.0-or-later

import {DragItemType} from '@app/features/app/components/layout/types/DndTypes';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import {ExpressionPickerPopout} from '@app/features/expressions/components/popouts/ExpressionPickerPopout';
import {getSkinTonedSurrogate} from '@app/features/expressions/utils/SkinToneUtils';
import styles from '@app/features/signal_bar/components/GuildSignalBarTab.module.css';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {getSignalImageUrl, moveSignal} from '@app/features/signal_bar/utils/SignalUtils';
import {Button} from '@app/features/ui/button/Button';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {
	MAX_SIGNAL_BAR_SIGNALS,
	MAX_SIGNAL_LABEL_LENGTH,
	type SignalBarSignal,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {DotsSixVerticalIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import {useCallback, useEffect, useRef, useState} from 'react';
import {DndProvider, useDrag, useDrop} from 'react-dnd';
import {HTML5Backend} from 'react-dnd-html5-backend';

const SAVE_FAILED_DESCRIPTOR = msg({
	message: 'Failed to save the signal bar. Try again.',
	comment: 'Error toast in the community Message Tools settings tab when saving the signal bar fails.',
});
const LABEL_DESCRIPTOR = msg({
	message: 'Signal label',
	comment: 'Accessible label for the text field that names a signal in the Message Tools settings tab.',
});
const REMOVE_DESCRIPTOR = msg({
	message: 'Remove',
	comment: 'Button that removes a signal from the signal bar in the Message Tools settings tab. Keep it short.',
});

interface RowDragItem {
	index: number;
}

interface SignalRowProps {
	signal: SignalBarSignal;
	index: number;
	onMove: (from: number, to: number) => void;
	onCommit: () => void;
	onLabel: (index: number, label: string) => void;
	onRemove: (index: number) => void;
}

const SignalRow = ({signal, index, onMove, onCommit, onLabel, onRemove}: SignalRowProps) => {
	const {i18n} = useLingui();
	const [label, setLabel] = useState(signal.label ?? '');
	useEffect(() => setLabel(signal.label ?? ''), [signal.label]);
	const [{isDragging}, dragRef, previewRef] = useDrag(
		() => ({
			type: DragItemType.SIGNAL,
			item: (): RowDragItem => ({index}),
			collect: (monitor) => ({isDragging: monitor.isDragging()}),
			end: () => onCommit(),
		}),
		[index, onCommit],
	);
	const [, dropRef] = useDrop(
		() => ({
			accept: DragItemType.SIGNAL,
			hover: (item: RowDragItem) => {
				if (item.index === index) return;
				onMove(item.index, index);
				item.index = index;
			},
		}),
		[index, onMove],
	);
	const imageUrl = getSignalImageUrl(signal, true);
	return (
		<div
			ref={(node) => {
				previewRef(dropRef(node));
			}}
			className={clsx(styles.row, isDragging && styles.rowDragging)}
			data-flx="signal-bar.guild-signal-bar-tab.row"
		>
			<span
				ref={(node) => {
					dragRef(node);
				}}
				className={styles.handle}
				data-flx="signal-bar.guild-signal-bar-tab.handle"
			>
				<DotsSixVerticalIcon size={20} weight="bold" data-flx="signal-bar.guild-signal-bar-tab.handle-icon" />
			</span>
			{imageUrl ? (
				<img
					className={styles.emoji}
					src={imageUrl}
					alt=""
					draggable={false}
					data-flx="signal-bar.guild-signal-bar-tab.emoji"
				/>
			) : (
				<span className="emoji jumboable" data-flx="signal-bar.guild-signal-bar-tab.emoji-text">
					{signal.emoji_name}
				</span>
			)}
			<div className={styles.label} data-flx="signal-bar.guild-signal-bar-tab.label">
				<Input
					value={label}
					maxLength={MAX_SIGNAL_LABEL_LENGTH}
					placeholder={signal.emoji_name}
					aria-label={i18n._(LABEL_DESCRIPTOR)}
					onChange={(event) => setLabel(event.target.value)}
					onBlur={() => {
						if (label.trim() !== (signal.label ?? '')) onLabel(index, label.trim());
					}}
					data-flx="signal-bar.guild-signal-bar-tab.label-input"
				/>
			</div>
			<Button
				variant="secondary"
				small
				onClick={() => onRemove(index)}
				data-flx="signal-bar.guild-signal-bar-tab.remove"
			>
				{i18n._(REMOVE_DESCRIPTOR)}
			</Button>
		</div>
	);
};

export const GuildSignalBarTab = observer((_props: {guildId: string}) => {
	const {i18n} = useLingui();
	const {signals} = SignalBarStore;
	const [draft, setDraft] = useState<ReadonlyArray<SignalBarSignal> | null>(null);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	useEffect(() => {
		void SignalBarStore.fetchConfig();
	}, []);
	const save = useCallback(
		async (next: ReadonlyArray<SignalBarSignal>) => {
			const ok = await SignalBarStore.saveSignals(next);
			if (!ok) ToastCommands.createToast({type: 'error', children: i18n._(SAVE_FAILED_DESCRIPTOR)});
		},
		[i18n],
	);
	const handleMove = useCallback((from: number, to: number) => {
		setDraft((current) => moveSignal(current ?? SignalBarStore.signals, from, to));
	}, []);
	const handleCommit = useCallback(() => {
		const next = draftRef.current;
		if (!next) return;
		void save(next).finally(() => setDraft(null));
	}, [save]);
	const handleLabel = useCallback(
		(index: number, label: string) => {
			void save(SignalBarStore.signals.map((signal, i) => (i === index ? {...signal, label: label || null} : signal)));
		},
		[save],
	);
	const handleRemove = useCallback(
		(index: number) => {
			void save(SignalBarStore.signals.filter((_, i) => i !== index));
		},
		[save],
	);
	const handleAdd = useCallback(
		(emoji: FlatEmoji) => {
			void save([
				...SignalBarStore.signals,
				{
					id: '',
					emoji_id: emoji.id ?? null,
					emoji_name: emoji.id ? emoji.name : getSkinTonedSurrogate(emoji),
					animated: emoji.animated ?? false,
					label: null,
				},
			]);
		},
		[save],
	);
	const visible = draft ?? signals;
	return (
		<div className={styles.container} data-flx="signal-bar.guild-signal-bar-tab.container">
			<h2 className={styles.title} data-flx="signal-bar.guild-signal-bar-tab.title">
				<Trans>Signal Bar</Trans>
			</h2>
			<p className={styles.description} data-flx="signal-bar.guild-signal-bar-tab.description">
				<Trans>
					Signals are icons above the message box that anyone can switch on and off, and everyone in the conversation
					sees who has them on. This bar is shared by every community and direct message on this instance. Drag to
					reorder.
				</Trans>
			</p>
			{visible.length === 0 ? (
				<p className={styles.empty} data-flx="signal-bar.guild-signal-bar-tab.empty">
					<Trans>No signals yet. The bar stays hidden until you add one.</Trans>
				</p>
			) : (
				<DndProvider backend={HTML5Backend} data-flx="signal-bar.guild-signal-bar-tab.dnd-provider">
					<div className={styles.list} data-flx="signal-bar.guild-signal-bar-tab.list">
						{visible.map((signal, index) => (
							<SignalRow
								key={signal.id || `new-${index}`}
								signal={signal}
								index={index}
								onMove={handleMove}
								onCommit={handleCommit}
								onLabel={handleLabel}
								onRemove={handleRemove}
								data-flx="signal-bar.guild-signal-bar-tab.signal-row"
							/>
						))}
					</div>
				</DndProvider>
			)}
			<div className={styles.actions} data-flx="signal-bar.guild-signal-bar-tab.actions">
				<Popout
					position="top-start"
					animationType="none"
					offsetMainAxis={8}
					render={({onClose}) => (
						<ExpressionPickerPopout
							onEmojiSelect={(emoji) => {
								handleAdd(emoji);
								onClose();
							}}
							onClose={onClose}
							visibleTabs={['emojis']}
							data-flx="signal-bar.guild-signal-bar-tab.expression-picker-popout"
						/>
					)}
					data-flx="signal-bar.guild-signal-bar-tab.popout"
				>
					<Button disabled={signals.length >= MAX_SIGNAL_BAR_SIGNALS} data-flx="signal-bar.guild-signal-bar-tab.add">
						<Trans>Add signal</Trans>
					</Button>
				</Popout>
			</div>
		</div>
	);
});
