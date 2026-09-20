// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import GuildReadState from '@app/features/guild/state/GuildReadState';
import Guilds from '@app/features/guild/state/Guilds';
import Favorites from '@app/features/messaging/state/Favorites';
import Navigation from '@app/features/navigation/state/Navigation';
import ReadStates from '@app/features/read_state/state/ReadStates';
import LayoutState from '@app/features/ui/state/LayoutState';
import UserGuildSettings from '@app/features/user/state/UserGuildSettings';
import {ME} from '@fluxer/constants/src/AppConstants';
import {GUILD_TEXT_BASED_CHANNEL_TYPES} from '@fluxer/constants/src/ChannelConstants';

export interface CollapsedPanelBadges {
	mentionCount: number;
	hasUnread: boolean;
	serverListMentionCount: number;
	serverListHasUnread: boolean;
	channelListMentionCount: number;
	channelListHasUnread: boolean;
}

export const useCollapsedPanelBadges = (): CollapsedPanelBadges => {
	// Establish MobX reactivity for read state changes
	const _readStateVersion = ReadStates.version;
	const _guildReadStateVersion = GuildReadState.version;
	void _readStateVersion;
	void _guildReadStateVersion;

	const {leftSidebarVisible} = LayoutState;

	// When expanded, the badge is not shown on the collapsed button.
	// Keep badges visible during hover peek to prevent quick flashing.
	const shouldCheck = !leftSidebarVisible;

	const currentGuildId = Navigation.guildId;
	const currentChannelId = Navigation.channelId;
	const isDmContext = !currentGuildId || currentGuildId === ME || Navigation.context === 'dm';
	const isFavoritesContext = currentGuildId === '@favorites' || Navigation.context === 'favorites';

	let mentionCount = 0;
	let hasUnread = false;

	if (shouldCheck) {
		const totalMentions = GuildReadState.mentionCountAcrossGuilds(false);
		const activeChannelMentions = currentChannelId ? ReadStates.getMentionCount(currentChannelId) : 0;

		mentionCount = Math.max(0, totalMentions - activeChannelMentions);

		if (mentionCount === 0) {
			if (isDmContext) {
				const anyGuildUnread = GuildReadState.anyGuildUnread;
				const otherDmsUnread = Channels.getPrivateChannels().some(
					(c) => c.id !== currentChannelId && ReadStates.hasUnread(c.id),
				);
				hasUnread = anyGuildUnread || otherDmsUnread;
			} else if (isFavoritesContext) {
				const anyGuildUnread = GuildReadState.anyGuildUnread;
				const dmsUnread = Channels.getPrivateChannels().some((c) => ReadStates.hasUnread(c.id));
				const otherFavsUnread = Favorites.sortedChannels.some(
					(fav) => fav.channelId !== currentChannelId && ReadStates.hasUnread(fav.channelId),
				);
				hasUnread = anyGuildUnread || dmsUnread || otherFavsUnread;
			} else if (currentGuildId) {
				const otherGuildsUnread = Guilds.getGuildIds().some(
					(id) => id !== currentGuildId && GuildReadState.guildIsUnread(id),
				);
				const dmsUnread = Channels.getPrivateChannels().some((c) => ReadStates.hasUnread(c.id));
				const currentGuildChannelsUnread = Channels.getGuildChannels(currentGuildId).some(
					(c) =>
						c.id !== currentChannelId &&
						GUILD_TEXT_BASED_CHANNEL_TYPES.has(c.type) &&
						ReadStates.hasUnread(c.id) &&
						!UserGuildSettings.isMutedAtAnyLevel(currentGuildId, c.id),
				);
				hasUnread = otherGuildsUnread || dmsUnread || currentGuildChannelsUnread;
			}
		}
	}

	return {
		mentionCount,
		hasUnread,
		serverListMentionCount: mentionCount,
		serverListHasUnread: hasUnread,
		channelListMentionCount: mentionCount,
		channelListHasUnread: hasUnread,
	};
};
