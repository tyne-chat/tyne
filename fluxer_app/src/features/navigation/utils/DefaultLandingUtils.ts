// SPDX-License-Identifier: AGPL-3.0-or-later

import {Routes} from '@app/app/Routes';
import Accessibility from '@app/features/accessibility/state/Accessibility';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import GatewaySessions from '@app/features/gateway/transport/GatewaySessionPool';
import GuildListState from '@app/features/guild/state/GuildList';

function getFirstAvailableGuildId(): string | null {
	const guilds = GuildListState.guilds;
	for (const guild of guilds) {
		if (!guild.unavailable) {
			return guild.id;
		}
	}
	return null;
}

function getHomeFallbackPath(): string | null {
	const firstGuildId = getFirstAvailableGuildId();
	if (firstGuildId) {
		return Routes.guildChannel(firstGuildId);
	}
	if (!GatewaySessions.foregroundConnection.isReady) {
		return null;
	}
	const buttons = RuntimeConfig.serverListButtons;
	if (Accessibility.showFavorites && buttons.favorites) {
		return Routes.FAVORITES;
	}
	if (RuntimeConfig.discoveryAvailable && buttons.explore) {
		return Routes.DISCOVER;
	}
	return null;
}

function getDirectMessagesFallbackPath(): string {
	return getHomeFallbackPath() ?? Routes.ME;
}

export function getDefaultLandingPath(): string {
	if (RuntimeConfig.directMessagesDisabled) {
		return getDirectMessagesFallbackPath();
	}
	return Routes.ME;
}
