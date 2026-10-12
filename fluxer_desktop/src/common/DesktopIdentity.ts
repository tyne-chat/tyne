// SPDX-License-Identifier: AGPL-3.0-or-later

import {BUILD_CHANNEL, type BuildChannel} from '@electron/common/BuildChannel';

const DESKTOP_APP_NAMES: Record<BuildChannel, string> = {
	stable: 'Fluxer',
	canary: 'Fluxer Canary',
	development: 'Fluxer Development',
};
const MACOS_BUNDLE_IDS: Record<BuildChannel, string> = {
	stable: 'app.fluxer',
	canary: 'app.fluxer.canary',
	development: 'app.fluxer.development',
};
const LINUX_DESKTOP_ENTRY_IDS: Record<BuildChannel, string> = {
	stable: 'app.fluxer.FluxerDesktop',
	canary: 'app.fluxer.FluxerDesktopCanary',
	development: 'app.fluxer.FluxerDesktopDevelopment',
};
const LEGACY_LINUX_DESKTOP_ENTRY_IDS: Record<BuildChannel, string> = {
	stable: 'fluxer',
	canary: 'fluxer-canary',
	development: 'fluxer-development',
};
const LINUX_PORTAL_SESSION_TOKENS: Record<BuildChannel, string> = {
	stable: 'fluxer_global_shortcuts',
	canary: 'fluxer_canary_global_shortcuts',
	development: 'fluxer_development_global_shortcuts',
};
const WINDOWS_VELOPACK_IDS: Record<BuildChannel, string> = {
	stable: 'fluxer_desktop',
	canary: 'fluxer_desktop_canary',
	development: 'fluxer_desktop_development',
};
const WINDOWS_APP_USER_MODEL_IDS: Record<BuildChannel, string> = {
	stable: 'Fluxer.Fluxer',
	canary: 'Fluxer.Fluxer.Canary',
	development: 'Fluxer.Fluxer.Development',
};
const WINDOWS_TOAST_ACTIVATOR_CLSIDS: Record<BuildChannel, string> = {
	stable: '{48EEF21B-F3AE-431E-8CF2-386FFB2143F2}',
	canary: '{9CEDB5C0-3552-43B0-A279-2232E0CDF74C}',
	development: '{B277AB5D-371C-4098-A76D-1DAE00AC0863}',
};
// Fork: upstream dropped these with its manual download picker (959b03b5f), but the fork's GitHub
// release assets are still named by them (forkReleaseAssetName in ShellDownloadFormats.ts).
const DESKTOP_ARTIFACT_PRODUCT_NAMES: Record<BuildChannel, string> = {
	stable: 'Fluxer',
	canary: 'Fluxer-Canary',
	development: 'Fluxer-Development',
};

// Fork: builds of this fork are an app of their own, "Tyne", with its own name and IDs, as
// upstream's name and marks policy asks of a fork with functional changes (.github/GOVERNANCE.md).
// It can sit next to an official Fluxer install. scripts/build.mjs compiles FLUXER_FORK_IDENTITY
// into every build; electron-builder.config.cjs, scripts/fork-release-assets.mjs and the release
// workflow carry the matching packaging names (ForkIdentityConsistency.test.mjs holds them
// together). The IDs are under tyne.chat and must never change once a build has shipped: the
// system would take the app for a different one. Its link scheme is tyne:// (CHANNEL_APP_PROTOCOLS
// in Constants.ts); fluxer:// is left to the official app.
export const IS_FORK_IDENTITY = typeof process.env === 'object' && process.env.FLUXER_FORK_IDENTITY === '1';
if (IS_FORK_IDENTITY) {
	DESKTOP_APP_NAMES.stable = 'Tyne';
	DESKTOP_ARTIFACT_PRODUCT_NAMES.stable = 'Tyne';
	MACOS_BUNDLE_IDS.stable = 'chat.tyne.desktop';
	LINUX_DESKTOP_ENTRY_IDS.stable = 'chat.tyne.Tyne';
	LEGACY_LINUX_DESKTOP_ENTRY_IDS.stable = 'tyne';
	LINUX_PORTAL_SESSION_TOKENS.stable = 'tyne_global_shortcuts';
	WINDOWS_VELOPACK_IDS.stable = 'tyne_desktop';
	WINDOWS_APP_USER_MODEL_IDS.stable = 'TyneChat.Tyne';
	WINDOWS_TOAST_ACTIVATOR_CLSIDS.stable = '{353A331D-BBF0-49D3-9144-AD28E0EE5FE9}';
}

export const DESKTOP_APP_NAME = DESKTOP_APP_NAMES[BUILD_CHANNEL];
export const DESKTOP_ARTIFACT_PRODUCT_NAME = DESKTOP_ARTIFACT_PRODUCT_NAMES[BUILD_CHANNEL];
export const MACOS_BUNDLE_ID = MACOS_BUNDLE_IDS[BUILD_CHANNEL];
export const LINUX_DESKTOP_ENTRY_ID = LINUX_DESKTOP_ENTRY_IDS[BUILD_CHANNEL];
export const LINUX_PORTAL_SESSION_TOKEN = LINUX_PORTAL_SESSION_TOKENS[BUILD_CHANNEL];
export const LEGACY_LINUX_DESKTOP_ENTRY_ID = LEGACY_LINUX_DESKTOP_ENTRY_IDS[BUILD_CHANNEL];
export const LINUX_ICON_NAME = LEGACY_LINUX_DESKTOP_ENTRY_IDS[BUILD_CHANNEL];
export const WINDOWS_SHORTCUT_AUTHOR = IS_FORK_IDENTITY ? 'Tyne Chat' : 'Fluxer Platform AB';
export const WINDOWS_VELOPACK_ID = WINDOWS_VELOPACK_IDS[BUILD_CHANNEL];
export const WINDOWS_LEGACY_SQUIRREL_ID = 'fluxer_app';
export const WINDOWS_APP_USER_MODEL_ID = WINDOWS_APP_USER_MODEL_IDS[BUILD_CHANNEL];
export const WINDOWS_LEGACY_APP_USER_MODEL_IDS = [`velopack.${WINDOWS_VELOPACK_ID}`];
export const WINDOWS_TOAST_ACTIVATOR_CLSID = WINDOWS_TOAST_ACTIVATOR_CLSIDS[BUILD_CHANNEL];
