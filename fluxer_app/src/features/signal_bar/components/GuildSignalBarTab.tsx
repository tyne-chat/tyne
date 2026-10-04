// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/signal_bar/components/GuildSignalBarTab.module.css';
import {SignalBarChannelTree} from '@app/features/signal_bar/components/SignalBarChannelTree';
import {SignalBarEditor} from '@app/features/signal_bar/components/SignalBarEditor';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import {Trans} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useEffect} from 'react';

export const GuildSignalBarTab = observer(({guildId}: {guildId: string}) => {
	useEffect(() => {
		void SignalBarStore.fetchConfig();
	}, []);
	return (
		<div className={styles.container} data-flx="signal-bar.guild-signal-bar-tab.tab">
			{SignalBarStore.guildId === guildId && <SignalBarEditor data-flx="signal-bar.guild-signal-bar-tab.editor" />}
			<h2 className={styles.title} data-flx="signal-bar.guild-signal-bar-tab.channels-title">
				<Trans>Where the signal bar appears</Trans>
			</h2>
			<p className={styles.description} data-flx="signal-bar.guild-signal-bar-tab.channels-description">
				<Trans>
					The signal bar is off until you tick a channel here. Ticking a category or the whole community also covers
					channels created there later.
				</Trans>
			</p>
			<SignalBarChannelTree guildId={guildId} data-flx="signal-bar.guild-signal-bar-tab.channel-tree" />
		</div>
	);
});
