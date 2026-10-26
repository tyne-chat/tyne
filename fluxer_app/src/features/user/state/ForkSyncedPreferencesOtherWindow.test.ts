// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: a synced setting changed in another window or on another device within a minute of this
// window's own save of it applies here, and this window's next save keeps it; a late echo of the
// state its save replaced still does not undo the save (tyne-chat/tyne#236).

import {createHash} from 'node:crypto';
import {beforeEach, describe, expect, it, type MockInstance, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

import {create} from '@bufbuild/protobuf';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {
	decodeSyncedPreferences,
	encodeSyncedPreferences,
	SyncedPreferencesSchema,
} from '@fluxer/schema/src/domains/user/SyncedPreferencesCodec';
import {EmojiPinsStateSchema} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/fork_emoji_pins_pb';
import {SidebarPreferencesSchema} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/preferences_pb';

type UserSettingsStore = typeof import('@app/features/user/state/UserSettings').default;

function blob(pins: Array<string>, inlineDmsCollapsed = true): string {
	return encodeSyncedPreferences(
		create(SyncedPreferencesSchema, {sidebar: {inlineDmsCollapsed}, emojiPins: {pinnedEmojiIds: pins}}),
	);
}

function settings(syncedPreferences: string): Record<string, unknown> {
	// A whole settings object, as READY and USER_SETTINGS_UPDATE carry.
	return {
		status: 'online',
		theme: 'dark',
		locale: 'en-US',
		synced_preferences: syncedPreferences,
		render_embeds: true,
		profile_privacy: 0,
		privacy_setup_version: 0,
		restricted_guilds: [],
		bot_restricted_guilds: [],
		default_guilds_restricted: false,
		bot_default_guilds_restricted: false,
		inline_attachment_media: true,
		inline_embed_media: true,
		gif_auto_play: true,
		render_reactions: true,
		animate_emoji: true,
		animate_stickers: 0,
		render_spoilers: 0,
		message_display_compact: false,
		friend_source_flags: 0,
		incoming_call_flags: 0,
		group_dm_add_permission_flags: 0,
		guild_folders: [],
		afk_timeout: 600,
		time_format: 0,
		developer_mode: false,
		trusted_domains: [],
		default_hide_muted_channels: false,
		sensitive_content_friend_dm_filter: 0,
		sensitive_content_non_friend_dm_filter: 0,
		sensitive_content_guild_filter: 0,
		suppress_unprivileged_self_mentions: false,
		suppress_unprivileged_self_mentions_bypass_user_ids: [],
		staff_dm_access_user_ids: [],
		default_share_voice_activity: false,
	};
}

let UserSettings: UserSettingsStore;
let patch: MockInstance;
const pushed = (): Array<string> =>
	patch.mock.calls.map(([, options]) => (options as {body: {synced_preferences: string}}).body.synced_preferences);
const pushedPins = (index: number) => decodeSyncedPreferences(pushed()[index]).emojiPins?.pinnedEmojiIds ?? [];
const pins = () => UserSettings.getSubPreference('emojiPins')?.pinnedEmojiIds ?? [];
const savePins = (keys: Array<string>) =>
	UserSettings.setSubPreference('emojiPins', create(EmojiPinsStateSchema, {pinnedEmojiIds: keys}));

beforeEach(async () => {
	// Each test starts as a fresh window: no settings kept from the one before.
	localStorage.clear();
	sessionStorage.clear();
	vi.resetModules();
	const {http} = await import('@app/features/platform/transport/RestTransport');
	// The server keeps what it is sent and sends it back, as the API does.
	patch = vi.spyOn(http, 'patch').mockImplementation(async (_url, options) => ({
		ok: true,
		status: 200,
		headers: {},
		body: {synced_preferences: (options as {body: {synced_preferences: string}}).body.synced_preferences},
	}));
	UserSettings = (await import('@app/features/user/state/UserSettings')).default;
	UserSettings.updateUserSettings(settings(blob([])));
});

describe('a synced setting saved here and changed elsewhere within the minute', () => {
	it('takes the change made elsewhere, and keeps it in the next save', async () => {
		await savePins(['unicode:dog']);
		expect(pushedPins(0)).toEqual(['unicode:dog']);

		UserSettings.updateUserSettings(settings(blob(['unicode:dog', 'unicode:fire'])));
		expect(pins()).toEqual(['unicode:dog', 'unicode:fire']);

		await UserSettings.setSubPreference('sidebar', create(SidebarPreferencesSchema, {inlineDmsCollapsed: false}));
		expect(pushed()).toHaveLength(2);
		expect(pushedPins(1)).toEqual(['unicode:dog', 'unicode:fire']);
	});

	it('still ignores a late echo of the state its save replaced', async () => {
		await savePins(['unicode:dog']);

		UserSettings.updateUserSettings(settings(blob([])));
		expect(pins()).toEqual(['unicode:dog']);
	});

	it('takes another window undoing its save once the echo of the save has come', async () => {
		// Pin here, then unpin in another window: the blob is the one before the pin again.
		await savePins(['unicode:dog']);
		UserSettings.updateUserSettings(settings(pushed()[0]));

		UserSettings.updateUserSettings(settings(blob([])));
		expect(pins()).toEqual([]);
	});

	it('takes another window undoing its save when the echo came before the response', async () => {
		patch.mockImplementationOnce(async (_url, options) => {
			const sent = (options as {body: {synced_preferences: string}}).body.synced_preferences;
			UserSettings.updateUserSettings(settings(sent));
			return {ok: true, status: 200, headers: {}, body: {synced_preferences: sent}};
		});
		await savePins(['unicode:dog']);

		UserSettings.updateUserSettings(settings(blob([])));
		expect(pins()).toEqual([]);
	});

	it('takes a change made elsewhere that it learns of from the refetch after a conflict', async () => {
		// The server keeps one blob and refuses a save whose base is not that blob, as the API does.
		const {http} = await import('@app/features/platform/transport/RestTransport');
		const {HttpError} = await import('@app/features/platform/types/EndpointError');
		let server = blob([]);
		const hash = (b: string) => createHash('sha256').update(Buffer.from(b, 'base64')).digest('hex');
		patch.mockImplementation(async (_url, options) => {
			const body = (options as {body: {synced_preferences: string; synced_preferences_base_hash?: string}}).body;
			if (body.synced_preferences_base_hash !== undefined && body.synced_preferences_base_hash !== hash(server)) {
				throw new HttpError({
					method: 'PATCH',
					path: '/users/@me/settings',
					status: 409,
					body: {code: APIErrorCodes.SYNCED_PREFERENCES_CONFLICT},
				});
			}
			server = body.synced_preferences;
			return {ok: true, status: 200, headers: {}, body: {synced_preferences: server}};
		});
		vi.spyOn(http, 'get').mockImplementation(async () => ({
			ok: true,
			status: 200,
			headers: {},
			body: {synced_preferences: server},
		}));

		await savePins(['unicode:dog']);
		// Another window pins too; its event has not reached this one yet.
		server = blob(['unicode:dog', 'unicode:fire']);

		await UserSettings.setSubPreference('sidebar', create(SidebarPreferencesSchema, {inlineDmsCollapsed: false}));
		expect(pins()).toEqual(['unicode:dog', 'unicode:fire']);
		expect(decodeSyncedPreferences(server).emojiPins?.pinnedEmojiIds).toEqual(['unicode:dog', 'unicode:fire']);
	});

	it('takes the echo of its own save without sending anything more', async () => {
		await savePins(['unicode:dog']);

		UserSettings.updateUserSettings(settings(pushed()[0]));
		await Promise.resolve();
		expect(pins()).toEqual(['unicode:dog']);
		expect(pushed()).toHaveLength(1);
	});
});
