// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the desktop app can have several app windows open at once (see the fork block at the end
// of fluxer_desktop/src/main/Window.ts). These are the calls the app makes because of that. In a
// browser, and in a desktop build without the feature, each one falls back to what a single
// window would do.

import {Logger} from '@app/features/platform/utils/AppLogger';
import {getElectronAPI} from '@app/features/ui/utils/NativeUtils';
import type React from 'react';

const logger = new Logger('ForkAppWindows');

// Opens an in-app route such as Routes.guildChannel(...) in another window (a new tab on the web).
export function openRouteInNewWindow(route: string): void {
	const appWindows = getElectronAPI()?.appWindows;
	if (appWindows == null) {
		window.open(route, '_blank');
		return;
	}
	appWindows.open(route).catch((error: unknown) => {
		logger.warn('Failed to open another app window', error);
	});
}

// For onAuxClick: a middle click opens the route in another window.
export function openRouteInNewWindowOnMiddleClick(event: React.MouseEvent, route: string): void {
	if (event.button !== 1) return;
	event.preventDefault();
	event.stopPropagation();
	openRouteInNewWindow(route);
}

// Every open window hears about the same new message. Resolves true in the one window that
// should notify and play a sound for it, and always true where there is only one window.
export async function claimNotificationAcrossWindows(key: string, channelId: string | null = null): Promise<boolean> {
	const appWindows = getElectronAPI()?.appWindows;
	if (appWindows == null) return true;
	try {
		return await appWindows.claimNotification(key, channelId);
	} catch (error) {
		logger.warn('Failed to ask the other windows about a notification', error);
		return true;
	}
}
