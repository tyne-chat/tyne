// SPDX-License-Identifier: AGPL-3.0-or-later

// The fork's lines in upstream's READY handler (GatewayReady.ts). A rebase can drop one of them
// without a conflict, so each is pinned here: the persona reset on a new session, the signal bar
// and guild command resets, and the fork's REST work after READY.

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {ReadyPayload} from '@app/features/gateway/events/GatewayReady';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const recorder = vi.hoisted(() => {
	const calls: Array<string> = [];
	// Every store READY touches, as an object whose methods only record that they were called.
	const store = (name: string): unknown =>
		new Proxy(
			{},
			{
				get: (_target, property) => {
					if (typeof property !== 'string' || property === 'then') return undefined;
					return () => {
						calls.push(`${name}.${property}`);
					};
				},
			},
		);
	const fn =
		(name: string) =>
		(..._args: Array<unknown>): void => {
			calls.push(name);
		};
	return {calls, store, fn};
});

vi.mock('@app/features/app/domain_migration/DomainMigrationTrigger', () => ({
	startDomainMigrationTrigger: recorder.fn('startDomainMigrationTrigger'),
}));
vi.mock('@app/features/app/state/Initialization', () => ({default: recorder.store('Initialization')}));
vi.mock('@app/features/auth/state/AccountUserDataSync', () => ({
	syncAccountUserData: recorder.fn('syncAccountUserData'),
}));
vi.mock('@app/features/auth/state/Authentication', () => ({default: recorder.store('Authentication')}));
vi.mock('@app/features/auth/state/AuthSession', () => ({default: recorder.store('AuthSession')}));
// Upstream's boot hydration reads the document when it loads, which this test runs without.
vi.mock('@app/features/boot_state/BootHydration', () => ({flushBootHydration: () => {}}));
vi.mock('@app/features/channel/state/ChannelPins', () => ({default: recorder.store('ChannelPins')}));
vi.mock('@app/features/channel/state/Channels', () => ({default: recorder.store('Channels')}));
vi.mock('@app/features/connection/state/UserConnection', () => ({default: recorder.store('UserConnection')}));
vi.mock('@app/features/emoji/state/Emoji', () => ({default: recorder.store('Emoji')}));
vi.mock('@app/features/emoji/state/EmojiSticker', () => ({default: recorder.store('Sticker')}));
vi.mock('@app/features/expressions/state/FavoriteMemes', () => ({default: recorder.store('FavoriteMemes')}));
vi.mock('@app/features/forum/state/ForumPosts', () => ({default: recorder.store('ForumPosts')}));
vi.mock('@app/features/forum/state/ForumReadState', () => ({default: recorder.store('ForumReadState')}));
vi.mock('@app/features/gateway/events/AccountReadyWork', () => ({
	scheduleAccountReadyWork: recorder.fn('scheduleAccountReadyWork'),
}));
vi.mock('@app/features/guild/state/ChannelMemberCount', () => ({default: recorder.store('ChannelMemberCount')}));
vi.mock('@app/features/guild/state/GuildAvailability', () => ({default: recorder.store('GuildAvailability')}));
vi.mock('@app/features/guild/state/GuildCount', () => ({default: recorder.store('GuildCount')}));
vi.mock('@app/features/guild/state/GuildList', () => ({default: recorder.store('GuildList')}));
vi.mock('@app/features/guild/state/GuildReadState', () => ({default: recorder.store('GuildReadState')}));
vi.mock('@app/features/guild/state/Guilds', () => ({default: recorder.store('Guilds')}));
vi.mock('@app/features/guild/state/GuildVerification', () => ({default: recorder.store('GuildVerification')}));
vi.mock('@app/features/member/state/GuildMembers', () => ({default: recorder.store('GuildMembers')}));
vi.mock('@app/features/member/state/MemberSearch', () => ({default: recorder.store('MemberSearch')}));
vi.mock('@app/features/member/state/MemberSidebar', () => ({default: recorder.store('MemberSidebar')}));
vi.mock('@app/features/messaging/state/MessageReactions', () => ({default: recorder.store('MessageReactions')}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({default: recorder.store('Messages')}));
vi.mock('@app/features/messaging/state/SavedMessages', () => ({default: recorder.store('SavedMessages')}));
vi.mock('@app/features/navigation/state/NavigationSideEffects', () => ({
	default: recorder.store('NavigationSideEffects'),
}));
vi.mock('@app/features/notification/state/MentionFeed', () => ({default: recorder.store('MentionFeed')}));
vi.mock('@app/features/permissions/state/Permission', () => ({default: recorder.store('Permission')}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		info(): void {}
		warn(): void {}
		error(): void {}
		debug(): void {}
	},
}));
vi.mock('@app/features/presence/state/Presence', () => ({default: recorder.store('Presence')}));
vi.mock('@app/features/read_state/state/ReadStates', () => ({default: recorder.store('ReadStates')}));
vi.mock('@app/features/relationship/state/Relationships', () => ({default: recorder.store('Relationships')}));
vi.mock('@app/features/threads/state/ChannelThreads', () => ({default: recorder.store('ChannelThreads')}));
vi.mock('@app/features/threads/state/ThreadGuilds', () => ({default: recorder.store('ThreadGuilds')}));
vi.mock('@app/features/threads/state/ThreadSubscriptions', () => ({default: recorder.store('ThreadSubscriptions')}));
vi.mock('@app/features/user/state/UserGuildSettings', () => ({default: recorder.store('UserGuildSettings')}));
vi.mock('@app/features/user/state/UserNote', () => ({default: recorder.store('UserNote')}));
vi.mock('@app/features/user/state/UserPinnedDM', () => ({default: recorder.store('UserPinnedDM')}));
vi.mock('@app/features/user/state/UserSettings', () => ({default: recorder.store('UserSettings')}));
vi.mock('@app/features/user/state/Users', () => ({default: recorder.store('Users')}));
vi.mock('@app/features/user/state/WebAuthnCredentials', () => ({default: recorder.store('WebAuthnCredentials')}));
vi.mock('@app/features/voice/state/RtcRegions', () => ({default: recorder.store('RtcRegions')}));
vi.mock('@app/features/voice/VoiceGatewayLifecycle', () => ({
	seedVoiceStatesFromReady: recorder.fn('seedVoiceStatesFromReady'),
}));
vi.mock('@app/features/gateway/events/ForkAccountReadyWork', () => ({
	scheduleForkAccountReadyWork: recorder.fn('scheduleForkAccountReadyWork'),
}));
vi.mock('@app/features/guild_commands/state/GuildCommandsStore', () => ({
	default: recorder.store('GuildCommandsStore'),
}));
vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	resetFetchPersonasCooldown: recorder.fn('PersonaCommands.resetFetchPersonasCooldown'),
}));
vi.mock('@app/features/persona/state/PersonaStore', () => ({PersonaStore: recorder.store('PersonaStore')}));
vi.mock('@app/features/signal_bar/state/SignalBarStore', () => ({default: recorder.store('SignalBarStore')}));

const {handleReady} = await import('@app/features/gateway/events/GatewayReady');

const USER_ID = '100000000000000001';

function ready(sessionId: string): ReadyPayload {
	return {session_id: sessionId, guilds: [], user: {id: USER_ID} as ReadyPayload['user']};
}

function context(previousSessionId: string | null): GatewayHandlerContext {
	return {
		socket: null,
		accountKey: 'account-1',
		expectedUserId: USER_ID,
		previousSessionId,
		setPreviousSessionId: () => {},
		setReady: () => true,
		setConnectionGeoip: () => {},
		markGuildSynced: () => {},
	};
}

const count = (name: string): number => recorder.calls.filter((call) => call === name).length;
const position = (name: string): number => recorder.calls.indexOf(name);

describe("the fork's work on READY", () => {
	beforeEach(() => {
		recorder.calls.length = 0;
	});

	it('resets the signal bar and the guild commands and starts the persona loading on every READY', () => {
		handleReady(ready('session-1'), context(null));

		expect(count('SignalBarStore.invalidate')).toBe(1);
		expect(count('GuildCommandsStore.invalidate')).toBe(1);
		expect(count('scheduleForkAccountReadyWork')).toBe(1);
		// The work runs for the account READY names, so after upstream has stored it.
		expect(position('scheduleForkAccountReadyWork')).toBeGreaterThan(position('Users.handleGatewayReady'));
	});

	it('keeps the personas on the first READY and on a READY for the same session', () => {
		handleReady(ready('session-1'), context(null));
		handleReady(ready('session-1'), context('session-1'));

		expect(count('PersonaStore.reset')).toBe(0);
		expect(count('PersonaCommands.resetFetchPersonasCooldown')).toBe(0);
		expect(count('scheduleForkAccountReadyWork')).toBe(2);
	});

	it('empties the personas and lifts the fetch cooldown on a new session, before loading them again', () => {
		handleReady(ready('session-2'), context('session-1'));

		expect(count('Messages.handleSessionInvalidated')).toBe(1);
		expect(count('PersonaStore.reset')).toBe(1);
		expect(count('PersonaCommands.resetFetchPersonasCooldown')).toBe(1);
		expect(position('PersonaStore.reset')).toBeLessThan(position('scheduleForkAccountReadyWork'));
		expect(position('PersonaCommands.resetFetchPersonasCooldown')).toBeLessThan(
			position('scheduleForkAccountReadyWork'),
		);
	});

	it('does none of it for a READY that names another account than expected', () => {
		expect(() => handleReady(ready('session-1'), {...context(null), expectedUserId: '100000000000000002'})).toThrow(
			/READY user mismatch/,
		);

		expect(recorder.calls).toEqual([]);
	});
});
