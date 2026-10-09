// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: labels for the extra app windows (see ForkAppWindows.ts) and for the desktop updater's
// dialogs that only this fork shows (fluxer_desktop/src/main/ForkShellUpdate.ts).

import {msg} from '@lingui/core/macro';

export const OPEN_IN_NEW_WINDOW_DESCRIPTOR = msg({
	message: 'Open in new window',
	comment:
		'Action menu item. Opens the selected community, channel or conversation in another app window (a new browser tab on the web).',
});
export const NEW_WINDOW_DESCRIPTOR = msg({
	message: 'New window',
	comment: 'Desktop app File menu item. Opens another app window showing the same place as the current one.',
});
export const UPDATE_READY_MESSAGE_DESCRIPTOR = msg({
	message: '{appName} {version} is ready to install.',
	comment:
		'Native desktop dialog headline shown when an update has finished downloading. {appName} is the desktop app name and {version} the new version number.',
});
export const UPDATE_RESTART_NOW_DESCRIPTOR = msg({
	message: 'Restart now',
	comment:
		'Button on the native desktop dialog shown when an update has finished downloading. Closes the app, installs the update and opens the app again.',
});
