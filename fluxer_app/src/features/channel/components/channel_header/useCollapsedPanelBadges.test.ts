// SPDX-License-Identifier: AGPL-3.0-or-later

import {ME} from '@fluxer/constants/src/AppConstants';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
	sidebarVisible: false,
	guildId: null as string | null,
	channelId: null as string | null,
	context: null as string | null,
	mentionsAcrossGuilds: 0,
	channelMentions: new Map<string, number>(),
	unreadChannels: new Set<string>(),
	unreadGuilds: new Set<string>(),
	privateChannels: [] as Array<{id: string}>,
	guildChannels: [] as Array<{id: string; type: number}>,
	guildIds: [] as Array<string>,
	favorites: [] as Array<{channelId: string}>,
	mutedChannels: new Set<string>(),
}));

vi.mock('@app/features/ui/state/LayoutState', () => ({
	default: {
		get leftSidebarVisible() {
			return state.sidebarVisible;
		},
	},
}));
vi.mock('@app/features/navigation/state/Navigation', () => ({
	default: {
		get guildId() {
			return state.guildId;
		},
		get channelId() {
			return state.channelId;
		},
		get context() {
			return state.context;
		},
	},
}));
vi.mock('@app/features/read_state/state/ReadStates', () => ({
	default: {
		version: 0,
		getMentionCount: (channelId: string) => state.channelMentions.get(channelId) ?? 0,
		hasUnread: (channelId: string) => state.unreadChannels.has(channelId),
	},
}));
vi.mock('@app/features/guild/state/GuildReadState', () => ({
	default: {
		version: 0,
		mentionCountAcrossGuilds: () => state.mentionsAcrossGuilds,
		get anyGuildUnread() {
			return state.unreadGuilds.size > 0;
		},
		guildIsUnread: (guildId: string) => state.unreadGuilds.has(guildId),
	},
}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {
		getPrivateChannels: () => state.privateChannels,
		getGuildChannels: () => state.guildChannels,
	},
}));
vi.mock('@app/features/guild/state/Guilds', () => ({default: {getGuildIds: () => state.guildIds}}));
vi.mock('@app/features/messaging/state/Favorites', () => ({
	default: {
		get sortedChannels() {
			return state.favorites;
		},
	},
}));
vi.mock('@app/features/user/state/UserGuildSettings', () => ({
	default: {isMutedAtAnyLevel: (_guildId: string, channelId: string) => state.mutedChannels.has(channelId)},
}));

const {useCollapsedPanelBadges} = await import('./useCollapsedPanelBadges');

describe('badges on the collapsed panel button', () => {
	beforeEach(() => {
		Object.assign(state, {
			sidebarVisible: false,
			guildId: null,
			channelId: null,
			context: null,
			mentionsAcrossGuilds: 0,
			channelMentions: new Map(),
			unreadChannels: new Set(),
			unreadGuilds: new Set(),
			privateChannels: [],
			guildChannels: [],
			guildIds: [],
			favorites: [],
			mutedChannels: new Set(),
		});
	});

	it('shows nothing while the panel is open', () => {
		state.sidebarVisible = true;
		state.mentionsAcrossGuilds = 4;
		state.unreadGuilds.add('g2');

		expect(useCollapsedPanelBadges()).toMatchObject({mentionCount: 0, hasUnread: false});
	});

	it('counts mentions everywhere except the channel being read', () => {
		state.guildId = 'g1';
		state.channelId = 'c1';
		state.mentionsAcrossGuilds = 5;
		state.channelMentions.set('c1', 2);

		expect(useCollapsedPanelBadges()).toMatchObject({mentionCount: 3, channelListMentionCount: 3});
	});

	it('in a DM, shows unread for another DM or any community, not for the DM being read', () => {
		state.guildId = ME;
		state.channelId = 'dm1';
		state.privateChannels = [{id: 'dm1'}, {id: 'dm2'}];
		state.unreadChannels.add('dm1');
		expect(useCollapsedPanelBadges().hasUnread).toBe(false);

		state.unreadChannels.add('dm2');
		expect(useCollapsedPanelBadges().hasUnread).toBe(true);

		state.unreadChannels.delete('dm2');
		state.unreadGuilds.add('g1');
		expect(useCollapsedPanelBadges().hasUnread).toBe(true);
	});

	it('in favorites, shows unread for another favorite or any DM, not for the favorite being read', () => {
		state.guildId = '@favorites';
		state.channelId = 'fav1';
		state.favorites = [{channelId: 'fav1'}, {channelId: 'fav2'}];
		state.unreadChannels.add('fav1');
		expect(useCollapsedPanelBadges().hasUnread).toBe(false);

		state.unreadChannels.add('fav2');
		expect(useCollapsedPanelBadges().hasUnread).toBe(true);

		state.unreadChannels.delete('fav2');
		state.privateChannels = [{id: 'dm1'}];
		state.unreadChannels.add('dm1');
		expect(useCollapsedPanelBadges().hasUnread).toBe(true);
	});

	it('in a community, ignores the channel being read, muted channels and categories', () => {
		state.guildId = 'g1';
		state.channelId = 'read';
		state.guildIds = ['g1'];
		state.unreadGuilds.add('g1');
		state.guildChannels = [
			{id: 'read', type: ChannelTypes.GUILD_TEXT},
			{id: 'muted', type: ChannelTypes.GUILD_TEXT},
			{id: 'category', type: ChannelTypes.GUILD_CATEGORY},
		];
		state.mutedChannels.add('muted');
		for (const id of ['read', 'muted', 'category']) state.unreadChannels.add(id);
		expect(useCollapsedPanelBadges().hasUnread).toBe(false);

		state.guildChannels.push({id: 'news', type: ChannelTypes.GUILD_TEXT});
		state.unreadChannels.add('news');
		expect(useCollapsedPanelBadges().hasUnread).toBe(true);
	});

	it('in a community, shows unread for another community', () => {
		state.guildId = 'g1';
		state.guildIds = ['g1', 'g2'];
		state.unreadGuilds.add('g2');

		expect(useCollapsedPanelBadges().hasUnread).toBe(true);
	});

	it('shows the mention count instead of the unread dot when there are mentions', () => {
		state.guildId = 'g1';
		state.mentionsAcrossGuilds = 1;
		state.guildIds = ['g1', 'g2'];
		state.unreadGuilds.add('g2');

		expect(useCollapsedPanelBadges()).toMatchObject({mentionCount: 1, hasUnread: false});
	});
});
