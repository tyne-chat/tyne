// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// A Favorites channel opened by its URL before the gateway is ready, as on a start or a reload, has to load its
// messages once the gateway is ready (tyne-chat/tyne#543). The Favorites routes have no :guildId, so Navigation left
// the guild empty there and the selected channel came out empty, and nothing loaded the channel.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	connection: {isReady: false, isConnected: false, connectionEpoch: 1},
}));

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({Trans: () => null, useLingui: () => ({i18n: {_: () => ''}})}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({http: {get: mocks.get}}));
// Through it Navigation imports half the app, which imports Navigation back before it has loaded. The fake router
// below never asks it anything.
vi.mock('@app/features/navigation/utils/ChannelNavigationGuard', () => ({
	tryInterceptChannelNavigationPath: () => false,
}));
vi.mock('@app/features/gateway/transport/GatewaySessionPool', () => ({
	default: {foregroundConnection: mocks.connection},
}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {
		getChannel: (id: string) =>
			id === DM_ID
				? {
						id,
						guildId: null,
						type: 1,
						lastMessageId: null,
						isPrivate: () => true,
						isThreadOnly: () => false,
						getRecipientId: () => '1546600000000000005',
					}
				: {id, guildId: GUILD_ID, type: 0, lastMessageId: null, isPrivate: () => false, isThreadOnly: () => false},
		getPrivateChannels: () => [],
		handleMessageCreate: vi.fn(),
	},
}));
vi.mock('@app/features/guild/state/Guilds', () => ({
	default: {getGuild: (id: string) => (id === GUILD_ID ? {id} : undefined)},
}));
vi.mock('@app/features/guild/state/GuildMatureContentAgree', () => ({default: {shouldShowGate: () => false}}));
vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
		getSnapshotOrNull: () => null,
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: 'me'}}));

const GUILD_ID = '1546600000000000001';
const CHANNEL_ID = '1546600000000000002';
const DM_ID = '1546600000000000003';
const MESSAGE_ID = '1546600000000000004';

const {default: Navigation} = await import('@app/features/navigation/state/Navigation');
const {default: SelectedChannel} = await import('@app/features/navigation/state/SelectedChannel');
const {default: NavigationSideEffects} = await import('@app/features/navigation/state/NavigationSideEffects');
const {default: Messages} = await import('@app/features/messaging/state/MessagingMessages');

import type {Match, Router, RouterState} from '@app/features/platform/components/router/RouterTypes';

// The routes these tests open, with the params upstream's router gives each (AppRoutes.tsx).
function routeFor(pathname: string): Match {
	const [, , scope, channelId, messageId] = pathname.split('/');
	if (scope === '@favorites' && messageId === undefined) {
		return {
			route: {id: channelId ? 'favoritesChannel' : 'favorites'} as Match['route'],
			params: channelId ? {channelId} : {},
			search: new URLSearchParams(),
		};
	}
	if (scope === '@me') {
		return {route: {id: 'dmChannel'} as Match['route'], params: {channelId}, search: new URLSearchParams()};
	}
	return {
		route: {id: messageId ? 'message' : 'channel'} as Match['route'],
		params: messageId ? {guildId: scope, channelId, messageId} : {guildId: scope, channelId},
		search: new URLSearchParams(),
	};
}

class FakeRouter {
	private state: RouterState;
	private readonly listeners = new Set<() => void>();

	constructor(pathname: string) {
		this.state = this.stateFor(pathname);
	}

	getState(): RouterState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	go(pathname: string): void {
		this.state = this.stateFor(pathname);
		for (const listener of this.listeners) listener();
	}

	private stateFor(pathname: string): RouterState {
		return {location: new URL(`https://app.test${pathname}`), matches: [routeFor(pathname)], navigating: false};
	}
}

const router = new FakeRouter('/');
Navigation.initialize(router as unknown as Router);
NavigationSideEffects.initialize();

function messageRequests(): Array<string> {
	return mocks.get.mock.calls.map(([url]) => String(url)).filter((url) => /\/channels\/\d+\/messages$/.test(url));
}

// What a page load does: the route is there first, the gateway gets ready after.
async function coldLoad(pathname: string): Promise<void> {
	mocks.connection.isConnected = false;
	mocks.connection.isReady = false;
	router.go(pathname);
	expect(messageRequests()).toEqual([]);
	mocks.connection.isConnected = true;
	mocks.connection.isReady = true;
	Messages.handleGatewayReady();
	await vi.waitFor(() => expect(Messages.getMessages(pathname.includes(DM_ID) ? DM_ID : CHANNEL_ID).ready).toBe(true));
}

beforeEach(() => {
	mocks.get.mockReset();
	mocks.get.mockResolvedValue({body: []});
});

afterEach(() => {
	router.go('/');
	Messages.handleSessionInvalidated();
	mocks.get.mockReset();
});

describe('Navigation on the Favorites routes', () => {
	it('names the Favorites guild on a Favorites channel and on the Favorites list', () => {
		router.go(`/channels/@favorites/${CHANNEL_ID}`);
		expect(Navigation.guildId).toBe('@favorites');
		expect(Navigation.channelId).toBe(CHANNEL_ID);
		expect(Navigation.context).toBe('favorites');
		router.go('/channels/@favorites');
		expect(Navigation.guildId).toBe('@favorites');
		expect(Navigation.channelId).toBeNull();
	});

	it("keeps upstream's guild for a Favorites message link, a guild channel and a DM", () => {
		router.go(`/channels/@favorites/${CHANNEL_ID}/${MESSAGE_ID}`);
		expect(Navigation.guildId).toBe('@favorites');
		expect(Navigation.messageId).toBe(MESSAGE_ID);
		router.go(`/channels/${GUILD_ID}/${CHANNEL_ID}`);
		expect(Navigation.guildId).toBe(GUILD_ID);
		router.go(`/channels/@me/${DM_ID}`);
		expect(Navigation.guildId).toBeNull();
		expect(Navigation.context).toBe('dm');
	});

	it('selects the channel open in Favorites', () => {
		router.go(`/channels/@favorites/${CHANNEL_ID}`);
		expect(SelectedChannel.currentChannelId).toBe(CHANNEL_ID);
	});
});

describe('Messages of a channel opened by its URL before the gateway is ready', () => {
	it('loads a guild channel opened in Favorites, with one request', async () => {
		await coldLoad(`/channels/@favorites/${CHANNEL_ID}`);
		expect(messageRequests()).toEqual([`/channels/${CHANNEL_ID}/messages`]);
	});

	it('loads a DM opened in Favorites, with one request', async () => {
		await coldLoad(`/channels/@favorites/${DM_ID}`);
		expect(messageRequests()).toEqual([`/channels/${DM_ID}/messages`]);
	});

	it('loads the same channel opened in its guild, with one request', async () => {
		await coldLoad(`/channels/${GUILD_ID}/${CHANNEL_ID}`);
		expect(messageRequests()).toEqual([`/channels/${CHANNEL_ID}/messages`]);
	});
});
