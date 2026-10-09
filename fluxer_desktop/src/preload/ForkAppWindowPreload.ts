// SPDX-License-Identifier: AGPL-3.0-or-later

import {FORK_APP_WINDOW_CHANNELS, type ForkAppWindowAPI} from '@fluxer/desktop_ipc/src/ForkAppWindowContract';

interface ForkAppWindowInvoker {
	invoke(channel: string, ...args: Array<unknown>): Promise<unknown>;
	send(channel: string, ...args: Array<unknown>): void;
}

export function createForkAppWindowPreloadAPI(renderer: ForkAppWindowInvoker): {appWindows: ForkAppWindowAPI} {
	return {
		appWindows: Object.freeze({
			open: (route: string): Promise<boolean> =>
				renderer.invoke(FORK_APP_WINDOW_CHANNELS.open, route) as Promise<boolean>,
			claimNotification: (key: string, channelId: string | null): Promise<boolean> =>
				renderer.invoke(FORK_APP_WINDOW_CHANNELS.claimNotification, key, channelId) as Promise<boolean>,
			reportViewedChannel: (channelId: string | null): void => {
				renderer.send(FORK_APP_WINDOW_CHANNELS.viewedChannel, channelId);
			},
			reportAccount: (accountKey: string | null): void => {
				renderer.send(FORK_APP_WINDOW_CHANNELS.account, accountKey);
			},
		}),
	};
}
