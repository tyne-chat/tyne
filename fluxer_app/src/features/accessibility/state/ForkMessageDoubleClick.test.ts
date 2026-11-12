// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: double-clicking a message edits your own and replies to anyone else's under a switch each,
// not one switch for both; an account with upstream's switch on keeps editing and stops replying
// (tyne-chat/tyne#611).

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
type ForkMessageDoubleClick = typeof import('@app/features/accessibility/state/ForkMessageDoubleClick');

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
let doubleClick: ForkMessageDoubleClick;
let patch: MockInstance;
const pushed = (): Array<string> =>
	patch.mock.calls.map(([, options]) => (options as {body: {synced_preferences: string}}).body.synced_preferences);

async function savedAfter(change: () => void): Promise<string> {
	const before = pushed().length;
	change();
	await vi.waitFor(() => expect(pushed().length).toBeGreaterThan(before));
	return pushed().at(-1) ?? '';
}

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
	await import('@app/features/accessibility/state/Accessibility');
	doubleClick = await import('@app/features/accessibility/state/ForkMessageDoubleClick');
});

describe('double-click on a message', () => {
	it("does neither when upstream's switch is off", () => {
		UserSettings.updateUserSettings(settings(blob({fontSize: 14})));
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: false, reply: false});
		expect(doubleClick.allowsMessageDoubleClick(true)).toBe(false);
		expect(doubleClick.allowsMessageDoubleClick(false)).toBe(false);
	});

	it("edits and does not reply when upstream's switch is on and nothing else is stored", () => {
		// Every account that turned upstream's switch on before the fork split it.
		UserSettings.updateUserSettings(settings(blob({messageDoubleClickActions: true})));
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: true, reply: false});
		expect(doubleClick.allowsMessageDoubleClick(true)).toBe(true);
		expect(doubleClick.allowsMessageDoubleClick(false)).toBe(false);
	});

	it('follows the stored switches', () => {
		UserSettings.updateUserSettings(
			settings(
				blob({messageDoubleClickActions: true, messageDoubleClickEdits: false, messageDoubleClickReplies: true}),
			),
		);
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: false, reply: true});
		expect(doubleClick.allowsMessageDoubleClick(true)).toBe(false);
		expect(doubleClick.allowsMessageDoubleClick(false)).toBe(true);
	});

	it("does neither while upstream's switch is off, whatever the fork's say", () => {
		UserSettings.updateUserSettings(
			settings(
				blob({messageDoubleClickActions: false, messageDoubleClickEdits: true, messageDoubleClickReplies: true}),
			),
		);
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: false, reply: false});
	});

	it("reads a record without the fork's switches as edit only, even after one with them", async () => {
		const first = blob({
			messageDoubleClickActions: true,
			messageDoubleClickEdits: false,
			messageDoubleClickReplies: true,
		});
		UserSettings.updateUserSettings(settings(first));
		// The window saves the record back with every field filled in; let the server answer first.
		const saved = await savedAfter(() => {});
		UserSettings.updateUserSettings(settings(saved));
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: false, reply: true});
		// What a client from before the split saves when its one switch is turned on.
		UserSettings.updateUserSettings(settings(blob({messageDoubleClickActions: true})));
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: true, reply: false});
	});
});

describe('changing the switches', () => {
	it("turns on replying alone, keeping upstream's switch on, and reads it back", async () => {
		UserSettings.updateUserSettings(settings(blob({fontSize: 14})));
		const saved = await savedAfter(() => doubleClick.setMessageDoubleClickActions({edit: false, reply: true}));
		expect(decodeSyncedPreferences(saved).accessibility).toMatchObject({
			messageDoubleClickActions: true,
			messageDoubleClickEdits: false,
			messageDoubleClickReplies: true,
		});

		UserSettings.updateUserSettings(settings(saved));
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: false, reply: true});
	});

	it('adds replying to editing', async () => {
		UserSettings.updateUserSettings(settings(blob({messageDoubleClickActions: true})));
		const saved = await savedAfter(() => doubleClick.setMessageDoubleClickActions({edit: true, reply: true}));
		expect(decodeSyncedPreferences(saved).accessibility).toMatchObject({
			messageDoubleClickActions: true,
			messageDoubleClickEdits: true,
			messageDoubleClickReplies: true,
		});
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: true, reply: true});
	});

	it("turns upstream's switch off with the last one", async () => {
		UserSettings.updateUserSettings(settings(blob({messageDoubleClickActions: true})));
		const saved = await savedAfter(() => doubleClick.setMessageDoubleClickActions({edit: false, reply: false}));
		expect(decodeSyncedPreferences(saved).accessibility).toMatchObject({
			messageDoubleClickActions: false,
			messageDoubleClickEdits: false,
			messageDoubleClickReplies: false,
		});

		UserSettings.updateUserSettings(settings(saved));
		expect(doubleClick.getMessageDoubleClickActions()).toEqual({edit: false, reply: false});
	});
});
