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

	const {serverListVisible, channelListVisible, isLeftHoverPeeking} = LayoutState;

	// When expanded or actively peeking, the badges are not shown on the collapsed buttons
	const shouldCheckServerList = !serverListVisible && !isLeftHoverPeeking;
	const shouldCheckChannelList = !channelListVisible && !isLeftHoverPeeking;

	const currentGuildId = Navigation.guildId;
	const currentChannelId = Navigation.channelId;
	const isDmContext = !currentGuildId || currentGuildId === ME || Navigation.context === 'dm';
	const isFavoritesContext = currentGuildId === '@favorites' || Navigation.context === 'favorites';

	let serverListMentionCount = 0;
	let serverListHasUnread = false;

	if (shouldCheckServerList) {
		const totalMentions = GuildReadState.mentionCountAcrossGuilds();
		let currentContextMentions = 0;

		if (isDmContext) {
			currentContextMentions = GuildReadState.directMessageMentionCount();
		} else if (isFavoritesContext) {
			for (const fav of Favorites.sortedChannels) {
				currentContextMentions += ReadStates.getMentionCount(fav.channelId);
			}
		} else if (currentGuildId) {
			currentContextMentions = GuildReadState.mentionCountForGuild(currentGuildId);
		}

		serverListMentionCount = Math.max(0, totalMentions - currentContextMentions);

		// If no mentions, check if any other guild or DM has standard unread messages
		if (serverListMentionCount === 0) {
			if (isDmContext) {
				serverListHasUnread = GuildReadState.anyGuildUnread;
			} else if (isFavoritesContext) {
				serverListHasUnread =
					GuildReadState.anyGuildUnread || Channels.getPrivateChannels().some((c) => ReadStates.hasUnread(c.id));
			} else {
				const otherGuildsUnread = Guilds.getGuildIds().some(
					(id) => id !== currentGuildId && GuildReadState.guildIsUnread(id),
				);
				const dmsUnread = Channels.getPrivateChannels().some((c) => ReadStates.hasUnread(c.id));
				serverListHasUnread = otherGuildsUnread || dmsUnread;
			}
		}
	}

	let channelListMentionCount = 0;
	let channelListHasUnread = false;

	if (shouldCheckChannelList) {
		const activeChannelMentions = currentChannelId ? ReadStates.getMentionCount(currentChannelId) : 0;

		if (isDmContext) {
			const totalDmMentions = GuildReadState.directMessageMentionCount();
			channelListMentionCount = Math.max(0, totalDmMentions - activeChannelMentions);
			if (channelListMentionCount === 0) {
				channelListHasUnread = Channels.getPrivateChannels().some(
					(c) => c.id !== currentChannelId && ReadStates.hasUnread(c.id),
				);
			}
		} else if (isFavoritesContext) {
			let favMentions = 0;
			let favHasUnread = false;
			for (const fav of Favorites.sortedChannels) {
				if (fav.channelId === currentChannelId) continue;
				favMentions += ReadStates.getMentionCount(fav.channelId);
				if (!favHasUnread && ReadStates.hasUnread(fav.channelId)) {
					favHasUnread = true;
				}
			}
			channelListMentionCount = favMentions;
			if (channelListMentionCount === 0) {
				channelListHasUnread = favHasUnread;
			}
		} else if (currentGuildId) {
			const guildMentions = GuildReadState.mentionCountForGuild(currentGuildId);
			channelListMentionCount = Math.max(0, guildMentions - activeChannelMentions);
			if (channelListMentionCount === 0) {
				const guildChannels = Channels.getGuildChannels(currentGuildId);
				channelListHasUnread = guildChannels.some(
					(c) =>
						c.id !== currentChannelId &&
						GUILD_TEXT_BASED_CHANNEL_TYPES.has(c.type) &&
						ReadStates.hasUnread(c.id) &&
						!UserGuildSettings.isMutedAtAnyLevel(currentGuildId, c.id),
				);
			}
		}
	}

	return {
		serverListMentionCount,
		serverListHasUnread,
		channelListMentionCount,
		channelListHasUnread,
	};
};
