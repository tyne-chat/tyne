// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: keeps the desktop main process told about the two things it needs from each app window
// to coordinate several of them (see ForkWindowCoordination.ts in fluxer_desktop): the channel
// this window shows while it has focus, and the account this window is signed in to.

import Accounts from '@app/features/auth/state/Accounts';
import Authentication from '@app/features/auth/state/Authentication';
import {AccountScopedWork} from '@app/features/platform/state/AccountScopedWork';
import {getElectronAPI} from '@app/features/ui/utils/NativeUtils';
import {reaction} from 'mobx';

// Signing in, signing out and switching account pass through in-between states. The main
// process reloads the other windows on a change, so only report a state that has held this long.
const ACCOUNT_REPORT_SETTLE_MS = 750;

interface ForkAppWindowBridgeOptions {
	readonly isFocused: () => boolean;
	readonly getViewedChannelId: () => string | null;
}

let started = false;

export function startForkAppWindowBridge(options: ForkAppWindowBridgeOptions): void {
	const appWindows = getElectronAPI()?.appWindows;
	if (appWindows == null || started) return;
	started = true;
	reaction(
		() => (options.isFocused() ? options.getViewedChannelId() : null),
		(channelId) => {
			appWindows.reportViewedChannel(channelId);
		},
		{fireImmediately: true},
	);
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	reaction(
		// undefined while signing in, signing out or switching account is still under way.
		() => {
			if (AccountScopedWork.isSuspended) return undefined;
			return Authentication.isAuthenticated ? Accounts.currentAccountKey : null;
		},
		(account) => {
			if (settleTimer != null) {
				clearTimeout(settleTimer);
				settleTimer = null;
			}
			if (account === undefined) return;
			settleTimer = setTimeout(() => {
				settleTimer = null;
				appWindows.reportAccount(account);
			}, ACCOUNT_REPORT_SETTLE_MS);
		},
		{fireImmediately: true},
	);
}
