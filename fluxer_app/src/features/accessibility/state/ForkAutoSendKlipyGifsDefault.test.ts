// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: "Automatically send GIFs when selected" stays on when a stored accessibility record does
// not mention it, and an "off" is saved as a value of its own (tyne-chat/tyne#536, #281).

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
import {AccessibilitySettingsSchema} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/accessibility_pb';

type UserSettingsStore = typeof import('@app/features/user/state/UserSettings').default;
type AccessibilityStore = typeof import('@app/features/accessibility/state/Accessibility').default;

function blob(accessibility: Parameters<typeof create<typeof AccessibilitySettingsSchema>>[1]): string {
	return encodeSyncedPreferences(
		create(SyncedPreferencesSchema, {accessibility: create(AccessibilitySettingsSchema, accessibility)}),
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
let Accessibility: AccessibilityStore;
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
	Accessibility = (await import('@app/features/accessibility/state/Accessibility')).default;
});

describe('automatically send GIFs when selected', () => {
	it('stays on when the stored accessibility settings do not mention it', () => {
		// What a phone before v1.2.14 stored (#281).
		UserSettings.updateUserSettings(settings(blob({fontSize: 14})));
		expect(Accessibility.fontSize).toBe(14);
		expect(Accessibility.autoSendKlipyGifs).toBe(true);
	});

	it('is off when stored off', () => {
		UserSettings.updateUserSettings(settings(blob({fontSize: 14, autoSendKlipyGifs: false})));
		expect(Accessibility.autoSendKlipyGifs).toBe(false);
	});

	it('saves off as a stored value, which reads back as off', async () => {
		UserSettings.updateUserSettings(settings(blob({fontSize: 14})));
		Accessibility.updateSettings({autoSendKlipyGifs: false});
		await vi.waitFor(() => expect(pushed().length).toBeGreaterThan(0));
		const saved = pushed().at(-1) ?? '';
		expect(decodeSyncedPreferences(saved).accessibility?.autoSendKlipyGifs).toBe(false);

		UserSettings.updateUserSettings(settings(saved));
		expect(Accessibility.autoSendKlipyGifs).toBe(false);
	});
});
