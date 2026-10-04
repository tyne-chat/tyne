// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import Guilds from '@app/features/guild/state/Guilds';
import styles from '@app/features/signal_bar/components/SignalBarChannelTree.module.css';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {
	buildSignalBarTree,
	categoryState,
	channelState,
	rootState,
	type SignalBarCheckState,
	setCategory,
	setChannel,
	setRoot,
} from '@app/features/signal_bar/utils/SignalBarTree';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Spinner} from '@app/features/ui/components/Spinner';
import type {GuildSignalBarSettings} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

const SAVE_FAILED_DESCRIPTOR = msg({
	message: 'Failed to save where the signal bar appears. Try again.',
	comment: 'Error toast in the community Message Tools settings tab when saving the channel checkboxes fails.',
});

interface TreeCheckboxProps {
	state: SignalBarCheckState;
	label: string;
	className: string;
	onChange: (enabled: boolean) => void;
}

const TreeCheckbox = ({state, label, className, onChange}: TreeCheckboxProps) => {
	const ref = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (ref.current) ref.current.indeterminate = state === 'mixed';
	}, [state]);
	return (
		<label className={clsx(styles.row, className)} data-flx="signal-bar.signal-bar-channel-tree.row">
			<input
				ref={ref}
				type="checkbox"
				className={styles.checkbox}
				checked={state === 'on'}
				aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
				onChange={() => onChange(state !== 'on')}
				data-flx="signal-bar.signal-bar-channel-tree.checkbox"
			/>
			<span className={styles.name} data-flx="signal-bar.signal-bar-channel-tree.name">
				{label}
			</span>
		</label>
	);
};

export const SignalBarChannelTree = observer(({guildId}: {guildId: string}) => {
	const {i18n} = useLingui();
	const guild = Guilds.getGuild(guildId);
	const channels = Channels.getGuildChannels(guildId);
	const tree = useMemo(() => buildSignalBarTree(channels), [channels]);
	const [settings, setSettings] = useState<GuildSignalBarSettings | null>(null);
	useEffect(() => {
		let active = true;
		void SignalBarStore.fetchGuildSettings(guildId).then((loaded) => {
			if (active && loaded) setSettings(loaded);
		});
		return () => {
			active = false;
		};
	}, [guildId]);
	const apply = useCallback(
		(next: GuildSignalBarSettings) => {
			const previous = settings;
			setSettings(next);
			void SignalBarStore.saveGuildSettings(guildId, next).then((saved) => {
				if (saved) return;
				setSettings(previous);
				ToastCommands.createToast({type: 'error', children: i18n._(SAVE_FAILED_DESCRIPTOR)});
			});
		},
		[guildId, i18n, settings],
	);
	if (!settings) {
		return <Spinner data-flx="signal-bar.signal-bar-channel-tree.spinner" />;
	}
	return (
		<div className={styles.tree} role="group" data-flx="signal-bar.signal-bar-channel-tree.tree">
			<TreeCheckbox
				state={rootState(settings, tree)}
				label={guild?.name ?? ''}
				className={styles.rowRoot}
				onChange={(enabled) => apply(setRoot(settings, enabled))}
				data-flx="signal-bar.signal-bar-channel-tree.root"
			/>
			{tree.channels.map((channel) => (
				<TreeCheckbox
					key={channel.id}
					state={channelState(settings, channel.id, null) ? 'on' : 'off'}
					label={`#${channel.name}`}
					className={styles.rowChannel}
					onChange={(enabled) => apply(setChannel(settings, tree, channel.id, enabled))}
					data-flx="signal-bar.signal-bar-channel-tree.channel"
				/>
			))}
			{tree.categories.map((category) => (
				<div key={category.id} data-flx="signal-bar.signal-bar-channel-tree.category">
					<TreeCheckbox
						state={categoryState(settings, category)}
						label={category.name}
						className={styles.rowCategory}
						onChange={(enabled) => apply(setCategory(settings, tree, category.id, enabled))}
						data-flx="signal-bar.signal-bar-channel-tree.category-row"
					/>
					{category.channels.map((channel) => (
						<TreeCheckbox
							key={channel.id}
							state={channelState(settings, channel.id, category.id) ? 'on' : 'off'}
							label={`#${channel.name}`}
							className={styles.rowNested}
							onChange={(enabled) => apply(setChannel(settings, tree, channel.id, enabled))}
							data-flx="signal-bar.signal-bar-channel-tree.nested-channel"
						/>
					))}
				</div>
			))}
		</div>
	);
});
