// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: what the app (renderer) can ask of the desktop main process about the extra app windows
// this fork adds. The main process side is the fork block at the end of
// fluxer_desktop/src/main/Window.ts; the app side is fluxer_app's ForkAppWindows.ts.

export const FORK_APP_WINDOW_CHANNELS = Object.freeze({
	open: 'fork-app-window:open',
	claimNotification: 'fork-app-window:claim-notification',
	viewedChannel: 'fork-app-window:viewed-channel',
	account: 'fork-app-window:account',
} as const);

export interface ForkAppWindowAPI {
	// Opens another app window on an in-app route such as /channels/1/2. Resolves false if it could not.
	open: (route: string) => Promise<boolean>;
	// Every window hears about the same new message. Resolves true for the one window that
	// should notify and play a sound for it.
	claimNotification: (key: string, channelId: string | null) => Promise<boolean>;
	// The channel this window is showing while it has focus, or null.
	reportViewedChannel: (channelId: string | null) => void;
	// The account this window is signed in to, or null. When it changes, the other windows reload.
	reportAccount: (accountKey: string | null) => void;
}
