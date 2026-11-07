// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: stripping tracking parameters from links is on unless turned off; a stored record without
// the setting, or no record at all, reads as on (tyne-chat/tyne#535).

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
import {
	decodeSyncedPreferences,
	encodeSyncedPreferences,
	SyncedPreferencesSchema,
} from '@fluxer/schema/src/domains/user/SyncedPreferencesCodec';

type UserSettingsStore = typeof import('@app/features/user/state/UserSettings').default;

// What the production backfill of 2026-11-07 stored: field 82, true.
const BACKFILLED = 'kAUB';

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
});

describe('strip tracking parameters from links', () => {
	it('is on for an account with no stored settings', () => {
		UserSettings.updateUserSettings(settings(''));
		expect(UserSettings.getSanitizeUrls()).toBe(true);
	});

	it('is on when the stored settings do not mention it', () => {
		UserSettings.updateUserSettings(
			settings(encodeSyncedPreferences(create(SyncedPreferencesSchema, {sidebar: {inlineDmsCollapsed: true}}))),
		);
		expect(UserSettings.getSanitizeUrls()).toBe(true);
	});

	it('is on with the value the backfill stored', () => {
		UserSettings.updateUserSettings(settings(BACKFILLED));
		expect(UserSettings.getSanitizeUrls()).toBe(true);
	});

	it('stays off when stored off', () => {
		UserSettings.updateUserSettings(
			settings(encodeSyncedPreferences(create(SyncedPreferencesSchema, {sanitizeUrls: false}))),
		);
		expect(UserSettings.getSanitizeUrls()).toBe(false);
	});

	it('saves off as a stored value, which reads back as off', async () => {
		UserSettings.updateUserSettings(settings(''));
		await UserSettings.setSanitizeUrls(false);
		expect(pushed()).toHaveLength(1);
		expect(decodeSyncedPreferences(pushed()[0]).sanitizeUrls).toBe(false);

		UserSettings.updateUserSettings(settings(pushed()[0]));
		expect(UserSettings.getSanitizeUrls()).toBe(false);
	});

	it('saves on in the same bytes as before the field became optional', async () => {
		UserSettings.updateUserSettings(settings(''));
		await UserSettings.setSanitizeUrls(false);
		await UserSettings.setSanitizeUrls(true);
		expect(pushed().at(-1)).toBe(BACKFILLED);
	});
});
