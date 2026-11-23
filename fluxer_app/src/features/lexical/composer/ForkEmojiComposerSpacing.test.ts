// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: "Add a space after emoji" (tyne-chat/tyne#650). On, as before the setting existed, a chosen
// emoji gets a space after it; off, it gets none. Other insertions keep upstream's spacing either way.

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

import type {ComposerHandle} from '@app/features/lexical/composer/ComposerHandle';
import type {ComposerInsertPayload, ComposerInsertSpacing} from '@app/features/lexical/composer/composerOffsets';
import {create} from '@bufbuild/protobuf';
import {
	decodeSyncedPreferences,
	encodeSyncedPreferences,
	SyncedPreferencesSchema,
} from '@fluxer/schema/src/domains/user/SyncedPreferencesCodec';
import {AccessibilitySettingsSchema} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/accessibility_pb';

type UserSettingsStore = typeof import('@app/features/user/state/UserSettings').default;
type AccessibilityStore = typeof import('@app/features/accessibility/state/Accessibility').default;
type AccessibilityCommandsModule = typeof import('@app/features/accessibility/commands/AccessibilityCommands');
type ComposerInsertionModule = typeof import('@app/features/lexical/composer/ComposerInsertion');

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
let AccessibilityCommands: AccessibilityCommandsModule;
let ComposerInsertion: ComposerInsertionModule;
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
	AccessibilityCommands = await import('@app/features/accessibility/commands/AccessibilityCommands');
	ComposerInsertion = await import('@app/features/lexical/composer/ComposerInsertion');
});

// A composer holding `display`, recording what is put in and with which spacing.
// `inserted` holds whether each insertion asked for a space after it.
function composer(display = ''): {handle: ComposerHandle; inserted: Array<boolean | undefined>} {
	const inserted: Array<boolean | undefined> = [];
	const handle = {
		getDisplayValue: () => display,
		getSegments: () => [],
		getSelection: () => ({start: display.length, end: display.length}),
		replaceRange: (_start: number, _end: number, _payload: ComposerInsertPayload, spacing?: ComposerInsertSpacing) => {
			inserted.push(spacing?.trailing);
		},
	} as unknown as ComposerHandle;
	return {handle, inserted};
}

const customEmoji: ComposerInsertPayload = {
	kind: 'customEmoji',
	emojiId: '1',
	animated: false,
	display: ':gay:',
	wire: '<:gay:1>',
};
const standardEmoji: ComposerInsertPayload = {
	kind: 'standardEmoji',
	name: 'smile',
	surrogate: '😄',
	url: null,
	display: '😄',
};
const mention: ComposerInsertPayload = {
	kind: 'mention',
	mentionType: 'user',
	id: '2',
	display: '@fox',
	wire: '<@2>',
};

describe('the setting', () => {
	it('is on for a record saved before it existed', () => {
		UserSettings.updateUserSettings(settings(blob({fontSize: 14})));
		expect(Accessibility.spaceAfterEmoji).toBe(true);
	});

	it('is off when stored off', () => {
		UserSettings.updateUserSettings(settings(blob({spaceAfterEmoji: false})));
		expect(Accessibility.spaceAfterEmoji).toBe(false);
	});

	it('is saved to the account when turned off', async () => {
		UserSettings.updateUserSettings(settings(blob({fontSize: 14})));
		const before = pushed().length;
		AccessibilityCommands.update({spaceAfterEmoji: false});
		await vi.waitFor(() => expect(pushed().length).toBeGreaterThan(before));
		expect(decodeSyncedPreferences(pushed().at(-1) ?? '').accessibility).toMatchObject({spaceAfterEmoji: false});
	});
});

describe('putting an emoji in the message box', () => {
	it("adds upstream's space after it while the setting is on", () => {
		UserSettings.updateUserSettings(settings(blob({fontSize: 14})));
		const {handle, inserted} = composer('hi ');
		ComposerInsertion.applyComposerReplacement(handle, {start: 3, end: 3}, customEmoji, {});
		ComposerInsertion.applyComposerReplacement(handle, {start: 3, end: 3}, standardEmoji, {trailing: true});
		expect(inserted).toEqual([true, true]);
	});

	it('adds no space after it while the setting is off, from the search or the picker', () => {
		UserSettings.updateUserSettings(settings(blob({spaceAfterEmoji: false})));
		const {handle, inserted} = composer('hi ');
		// The `:` search passes no spacing; the picker asks for a space unless one follows.
		ComposerInsertion.applyComposerReplacement(handle, {start: 3, end: 3}, customEmoji, {});
		ComposerInsertion.applyComposerReplacement(handle, {start: 3, end: 3}, standardEmoji, {
			leading: false,
			trailing: true,
		});
		expect(inserted).toEqual([false, false]);
	});

	it('leaves the spacing of a mention alone while the setting is off', () => {
		UserSettings.updateUserSettings(settings(blob({spaceAfterEmoji: false})));
		const {handle, inserted} = composer('hi ');
		ComposerInsertion.applyComposerReplacement(handle, {start: 3, end: 3}, mention, {trailing: true});
		expect(inserted).toEqual([true]);
	});
});
