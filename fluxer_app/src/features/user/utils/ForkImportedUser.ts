// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: placeholder accounts the Discord history import made for people not on Tyne (public user flag
// IMPORTED, tyne-chat/tyne#682). Nobody is behind them, so the app offers no message, call or friend
// actions for them; the server refuses those too.

import {PublicUserFlags} from '@fluxer/constants/src/UserConstants';

export function isImportedPlaceholder(user: {flags: number} | null | undefined): boolean {
	return user != null && (user.flags & PublicUserFlags.IMPORTED) === PublicUserFlags.IMPORTED;
}
