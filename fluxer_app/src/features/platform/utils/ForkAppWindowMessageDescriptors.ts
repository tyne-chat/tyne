// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: labels for the extra app windows (see ForkAppWindows.ts).

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
