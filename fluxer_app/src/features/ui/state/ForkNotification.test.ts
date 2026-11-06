// SPDX-License-Identifier: AGPL-3.0-or-later

// The fork's lines in upstream's Notification store: a message sent as a persona is announced under
// the persona's name and avatar, and with several desktop app windows open only the window that
// claims a message (claimNotificationAcrossWindows) announces it. Everything around the store is a
// stub, so each test sets exactly what the store reads.

import type {Channel} from '@app/features/channel/models/Channel';
import {ChannelTypes, MessageTypes} from '@fluxer/constants/src/ChannelConstants';
import {RelationshipTypes} from '@fluxer/constants/src/UserConstants';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import type {I18n} from '@lingui/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const ME = '1000000000000000001';

const env = vi.hoisted(() => ({
	channels: new Map<string, unknown>(),
	users: new Map<string, unknown>(),
	selectedChannelId: null as string | null,
	modalOpen: false,
	claim: true,
	showFails: false,
	claims: [] as Array<[string, string | null]>,
	sounds: [] as Array<string>,
	shown: [] as Array<{id: string; title: string; icon: string}>,
}));

vi.mock('@app/app/Routes', () => ({
	Routes: {
		ME: '/channels/@me',
		channelMessage: (guildId: string, channelId: string, messageId: string) =>
			`/channels/${guildId}/${channelId}/${messageId}`,
		dmChannelMessage: (channelId: string, messageId: string) => `/channels/@me/${channelId}/${messageId}`,
	},
}));
vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {directMessagesDisabled: false, friendsDisabled: false},
}));
vi.mock('@app/features/auth/state/Accounts', () => ({default: {currentAccountKey: 'account-1', currentUserId: ME}}));
vi.mock('@app/features/auth/state/Authentication', () => ({default: {currentUserId: ME}}));
vi.mock('@app/features/channel/state/Channels', () => ({
	default: {getChannel: (id: string) => env.channels.get(id)},
}));
vi.mock('@app/features/forum/utils/ForumNotificationUtils', () => ({
	formatNewPostNotificationSuffix: () => null,
	resolveNewPostNotificationLevel: () => null,
}));
vi.mock('@app/features/guild/state/GuildMatureContentAgree', () => ({default: {shouldShowGate: () => false}}));
vi.mock('@app/features/guild/state/Guilds', () => ({default: {getGuild: () => ({name: 'Garden'})}}));
vi.mock('@app/features/i18n/utils/CommonMessageDescriptors', () => ({GROUP_DM_DESCRIPTOR: {message: 'Group DM'}}));
vi.mock('@app/features/messaging/models/MessagingMessage', () => ({
	Message: class {
		readonly id: string;
		readonly author: unknown;
		readonly subprofile: unknown;
		constructor(message: {id: string; author: {id: string}; subprofile?: unknown}) {
			this.id = message.id;
			this.author = env.users.get(message.author.id);
			this.subprofile = message.subprofile ?? null;
		}
	},
}));
vi.mock('@app/features/messaging/utils/MessageUtils', () => ({isMentioned: () => false}));
vi.mock('@app/features/navigation/state/Navigation', () => ({default: {channelId: null, threadId: null}}));
vi.mock('@app/features/navigation/state/SelectedChannel', () => ({
	default: {
		get currentChannelId() {
			return env.selectedChannelId;
		},
	},
}));
vi.mock('@app/features/notification/utils/AccountEngineNotifications', () => ({
	startAccountEngineNotifications: () => {},
}));
vi.mock('@app/features/notification/utils/MessageNotificationPreview', () => ({
	buildMessageNotificationBody: () => 'hello',
}));
vi.mock('@app/features/notification/utils/NotificationIconURL', () => ({
	getNotificationIconURL: (user: {id: string}) => `account:${user.id}`,
}));
vi.mock('@app/features/notification/utils/NotificationTracker', () => ({
	clearChannelNotifications: () => {},
	trackNotification: () => {},
}));
vi.mock('@app/features/notification/utils/NotificationUtils', () => ({
	ensureDesktopNotificationClickHandler: () => {},
	isGranted: async () => true,
	isMacOSDesktopNotification: () => false,
	playDirectMessageNotificationSoundIfEnabled: () => env.sounds.push('dm'),
	playNotificationSoundIfEnabled: () => env.sounds.push('channel'),
	playSameChannelNotificationSoundIfEnabled: () => env.sounds.push('same-channel'),
	showNotification: async (notification: {id: string; title: string; icon: string}) => {
		if (env.showFails) throw new Error('notifications blocked');
		env.shown.push({id: notification.id, title: notification.title, icon: notification.icon});
		return {browserNotification: null, nativeNotificationId: null};
	},
}));
vi.mock('@app/features/platform/push/PushSubscriptionService', () => ({
	registerPushSubscription: async () => {},
	unregisterAllPushSubscriptions: async () => {},
}));
vi.mock('@app/features/platform/types/Env', () => ({IS_DEV: false}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		info(): void {}
		warn(): void {}
		error(): void {}
		debug(): void {}
	},
}));
vi.mock('@app/features/platform/utils/MobXPersistence', () => ({
	makePersistent: async () => {},
	stopPersistent: () => {},
}));
vi.mock('@app/features/platform/utils/StoreInitialization', () => ({initializeStore: () => {}}));
vi.mock('@app/features/presence/state/LocalPresence', () => ({default: {getStatus: () => 'online'}}));
vi.mock('@app/features/relationship/state/FriendsTab', () => ({default: {setTab: () => {}}}));
vi.mock('@app/features/relationship/state/Relationships', () => ({default: {isBlocked: () => false}}));
vi.mock('@app/features/relationship/utils/RelationshipMessageDescriptors', () => ({
	FRIEND_ADDED_DESCRIPTOR: {message: 'Friend added'},
}));
vi.mock('@app/features/streamer_mode/state/StreamerMode', () => ({default: {shouldDisableNotifications: false}}));
vi.mock('@app/features/threads/state/ThreadMemberships', () => ({default: {isMember: () => false}}));
vi.mock('@app/features/threads/utils/ThreadNotificationUtils', () => ({
	isThreadMuted: () => false,
	resolveThreadNotificationLevel: () => 0,
}));
vi.mock('@app/features/ui/state/Modal', () => ({default: {hasModalOpen: () => env.modalOpen}}));
vi.mock('@app/features/ui/utils/PwaUtils', () => ({isInstalledPwa: () => false}));
vi.mock('@app/features/user/state/UserGuildSettings', () => ({
	default: {
		isGuildOrChannelMuted: () => false,
		resolveEffectiveMessageNotifications: () => 0,
		resolvesToNoMessages: () => false,
	},
}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {getCurrentUser: () => ({id: ME}), getUser: (id: string) => env.users.get(id)},
}));
vi.mock('@app/features/user/utils/NicknameUtils', () => ({
	getNickname: (user: {nickname: string}) => user.nickname,
	getDisplayName: (user: {nickname: string}) => user.nickname,
}));
vi.mock('@app/features/persona/utils/PersonaNotificationIconURL', () => ({
	getPersonaNotificationIconURL: (user: {id: string}, _guildId: unknown, persona?: {avatar?: string | null} | null) =>
		persona?.avatar ? `persona:${persona.avatar}` : `account:${user.id}`,
}));
vi.mock('@app/features/platform/utils/ForkAppWindowBridge', () => ({startForkAppWindowBridge: () => {}}));
vi.mock('@app/features/platform/utils/ForkAppWindows', () => ({
	claimNotificationAcrossWindows: async (key: string, channelId: string | null = null) => {
		env.claims.push([key, channelId]);
		return env.claim;
	},
}));

const {default: Notification} = await import('@app/features/ui/state/Notification');

const AUTHOR = '1000000000000000002';
let nextMessageId = 3000000000000000000n;

function channel(id: string, type: number, name = 'general'): Channel {
	const value = {
		id,
		type,
		name,
		guildId: type === ChannelTypes.GUILD_TEXT ? 'guild-1' : null,
		parentId: null,
		isPrivate: () => type === ChannelTypes.DM || type === ChannelTypes.GROUP_DM,
		isThread: () => false,
	};
	env.channels.set(id, value);
	return value as unknown as Channel;
}

function message(channelId: string, subprofile: MessageSubprofileResponse | null, type: number = MessageTypes.DEFAULT) {
	nextMessageId += 1n;
	return {
		id: nextMessageId.toString(),
		channel_id: channelId,
		author: {id: AUTHOR},
		type,
		flags: 0,
		subprofile,
	} as unknown as WireMessage;
}

// The announcement runs on after handleMessageCreate returns: let its promise chain finish.
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const KIT: MessageSubprofileResponse = {id: 'p-kit', name: 'Kit', avatar: 'a1b2c3d4'};

describe('notifications for a message sent as a persona', () => {
	beforeEach(() => {
		env.channels.clear();
		env.users.clear();
		env.users.set(AUTHOR, {id: AUTHOR, nickname: 'Chiara'});
		env.selectedChannelId = null;
		env.modalOpen = false;
		env.claim = true;
		env.showFails = false;
		env.claims.length = 0;
		env.sounds.length = 0;
		env.shown.length = 0;
		Notification.setI18n({_: (descriptor: {message?: string}) => descriptor.message ?? ''} as unknown as I18n);
		Notification.handleNotificationPermissionGranted();
		Notification.handleWindowFocused({focused: false});
	});

	it("is titled with the persona's name and shows the persona's avatar", async () => {
		channel('general', ChannelTypes.GUILD_TEXT);
		const sent = message('general', KIT);

		expect(Notification.handleMessageCreate({message: sent})).toBe(true);
		await settle();

		expect(env.shown).toEqual([{id: sent.id, title: 'Kit (#general)', icon: 'persona:a1b2c3d4'}]);
	});

	it("is titled with the author's nickname when the message has no persona, or a persona without a name", async () => {
		channel('general', ChannelTypes.GUILD_TEXT);

		Notification.handleMessageCreate({message: message('general', null)});
		Notification.handleMessageCreate({message: message('general', {id: 'p-blank', name: '', avatar: null})});
		await settle();

		expect(env.shown.map((shown) => [shown.title, shown.icon])).toEqual([
			['Chiara (#general)', `account:${AUTHOR}`],
			['Chiara (#general)', `account:${AUTHOR}`],
		]);
	});

	it('titles a reply in a community channel like any message there', async () => {
		channel('general', ChannelTypes.GUILD_TEXT);

		Notification.handleMessageCreate({message: message('general', KIT, MessageTypes.REPLY)});
		await settle();

		expect(env.shown.map((shown) => shown.title)).toEqual(['Kit (#general)']);
	});

	it("is titled with the persona's name alone in a DM", async () => {
		channel('dm', ChannelTypes.DM, '');

		Notification.handleMessageCreate({message: message('dm', KIT)});
		await settle();

		expect(env.shown.map((shown) => shown.title)).toEqual(['Kit']);
		expect(env.sounds).toEqual(['dm']);
	});
});

describe('notifications with several app windows open', () => {
	beforeEach(() => {
		env.channels.clear();
		env.users.clear();
		env.users.set(AUTHOR, {id: AUTHOR, nickname: 'Chiara'});
		env.selectedChannelId = null;
		env.modalOpen = false;
		env.claim = true;
		env.showFails = false;
		env.claims.length = 0;
		env.sounds.length = 0;
		env.shown.length = 0;
		Notification.setI18n({_: (descriptor: {message?: string}) => descriptor.message ?? ''} as unknown as I18n);
		Notification.handleNotificationPermissionGranted();
		Notification.handleWindowFocused({focused: false});
	});

	it('announces a message the window claims, with its sound, once', async () => {
		channel('general', ChannelTypes.GUILD_TEXT);
		const sent = message('general', null);

		Notification.handleMessageCreate({message: sent});
		Notification.handleMessageCreate({message: sent});
		await settle();

		expect(env.claims).toEqual([[sent.id, 'general']]);
		expect(env.sounds).toEqual(['channel']);
		expect(env.shown).toHaveLength(1);
	});

	it('stays quiet about a message another window has already claimed', async () => {
		channel('general', ChannelTypes.GUILD_TEXT);
		env.claim = false;
		const sent = message('general', KIT);

		Notification.handleMessageCreate({message: sent});
		await settle();

		expect(env.claims).toEqual([[sent.id, 'general']]);
		expect(env.sounds).toEqual([]);
		expect(env.shown).toEqual([]);
	});

	it('claims a message the focused window shows, so that no other window announces it', async () => {
		channel('general', ChannelTypes.GUILD_TEXT);
		env.selectedChannelId = 'general';
		Notification.handleWindowFocused({focused: true});
		const sent = message('general', null);

		expect(Notification.handleMessageCreate({message: sent})).toBe(true);
		await settle();

		expect(env.claims).toEqual([[sent.id, 'general']]);
		expect(env.sounds).toEqual(['same-channel']);
		expect(env.shown).toEqual([]);
	});

	it('also claims it when a modal covers the channel the focused window shows', async () => {
		channel('general', ChannelTypes.GUILD_TEXT);
		env.selectedChannelId = 'general';
		env.modalOpen = true;
		Notification.handleWindowFocused({focused: true});
		const sent = message('general', null);

		expect(Notification.handleMessageCreate({message: sent})).toBe(true);
		await settle();

		expect(env.claims).toEqual([[sent.id, 'general']]);
		expect(env.sounds).toEqual(['channel']);
		expect(env.shown).toEqual([]);
	});

	it('announces a friend request only in the window that claims it', async () => {
		env.users.set('1000000000000000010', {id: '1000000000000000010', nickname: 'Robin'});
		env.users.set('1000000000000000011', {id: '1000000000000000011', nickname: 'Sam'});

		env.claim = false;
		Notification.handleRelationshipNotification({
			id: '1000000000000000010',
			type: RelationshipTypes.INCOMING_REQUEST,
		} as never);
		await settle();
		expect(env.shown).toEqual([]);

		env.claim = true;
		Notification.handleRelationshipNotification({
			id: '1000000000000000011',
			type: RelationshipTypes.INCOMING_REQUEST,
		} as never);
		await settle();

		expect(env.claims.map(([key]) => key)).toEqual([
			`relationship_${RelationshipTypes.INCOMING_REQUEST}_1000000000000000010`,
			`relationship_${RelationshipTypes.INCOMING_REQUEST}_1000000000000000011`,
		]);
		expect(env.shown.map((shown) => [shown.id, shown.title])).toEqual([
			[`relationship_${RelationshipTypes.INCOMING_REQUEST}_1000000000000000011`, 'Friend request'],
		]);
	});

	it('logs a friend notification the system refuses to show, and does not try it again', async () => {
		env.users.set('1000000000000000012', {id: '1000000000000000012', nickname: 'Ash'});
		env.showFails = true;
		const relationship = {id: '1000000000000000012', type: RelationshipTypes.FRIEND} as never;

		Notification.handleRelationshipNotification(relationship);
		await settle();
		Notification.handleRelationshipNotification(relationship);
		await settle();

		expect(env.claims).toEqual([[`relationship_${RelationshipTypes.FRIEND}_1000000000000000012`, null]]);
		expect(env.shown).toEqual([]);
	});
});
