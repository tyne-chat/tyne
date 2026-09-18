// SPDX-License-Identifier: AGPL-3.0-or-later

import {DiscoveryGuildHeader} from '@app/features/app/components/layout/DiscoveryGuildHeader';
import styles from '@app/features/app/components/layout/GuildLayout.module.css';
import {GuildSidebar} from '@app/features/app/components/layout/GuildSidebar';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {DiscoveryPage} from '@app/features/discovery/discovery/DiscoveryPage';
import {DiscoverySidebar} from '@app/features/discovery/discovery/DiscoverySidebar';
import Discovery from '@app/features/discovery/state/Discovery';
import {getDefaultLandingPath} from '@app/features/navigation/utils/DefaultLandingUtils';
import * as RouterUtils from '@app/features/navigation/utils/RouterUtils';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {observer} from 'mobx-react-lite';
import {useEffect} from 'react';

// Fork imports.

import LayoutState from '@app/features/ui/state/LayoutState';
import {clsx} from 'clsx';

export const DiscoveryLayout = observer(function DiscoveryLayout() {
	const mobileLayout = MobileLayout;
	const available = RuntimeConfig.discoveryAvailable;
	const isChannelListOpen = mobileLayout.enabled || LayoutState.channelListVisible;
	const isChannelListPeeking =
		!mobileLayout.enabled && !LayoutState.channelListVisible && LayoutState.isLeftHoverPeeking;
	useEffect(() => {
		if (!available) {
			RouterUtils.replaceWith(getDefaultLandingPath());
			return;
		}
		void Discovery.loadCategories();
		void Discovery.search({offset: 0});
		return () => {
			Discovery.reset();
		};
	}, [available]);
	if (!available) {
		return null;
	}
	if (mobileLayout.enabled) {
		return <DiscoveryPage data-flx="app.discovery-layout.discovery-page.mobile" />;
	}
	return (
		<div className={styles.guildLayoutContainer} data-flx="app.discovery-layout.guild-layout-container">
			<div
				className={clsx(styles.guildLayoutContent, !isChannelListOpen && styles.guildLayoutContentCollapsed)}
				data-flx="app.discovery-layout.guild-layout-content"
			>
				{isChannelListOpen && (
					<GuildSidebar
						header={<DiscoveryGuildHeader data-flx="app.discovery-layout.discovery-guild-header" />}
						content={<DiscoverySidebar data-flx="app.discovery-layout.discovery-sidebar" />}
						data-flx="app.discovery-layout.guild-sidebar"
					/>
				)}
				{isChannelListPeeking && (
					<div
						className={styles.guildSidebarOverlay}
						data-peek-drawer="left"
						data-flx="app.discovery-layout.guild-sidebar-overlay"
					>
						<GuildSidebar
							header={<DiscoveryGuildHeader data-flx="app.discovery-layout.discovery-guild-header--peek" />}
							content={<DiscoverySidebar data-flx="app.discovery-layout.discovery-sidebar--peek" />}
							data-flx="app.discovery-layout.guild-sidebar--peek"
						/>
					</div>
				)}
				<div className={styles.guildMainContent} data-flx="app.discovery-layout.guild-main-content">
					<DiscoveryPage data-flx="app.discovery-layout.discovery-page" />
				</div>
			</div>
		</div>
	);
});
