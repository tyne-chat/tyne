// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: the audio card's width (tyne-chat/tyne#873). Upstream's audio card is at most 25rem wide;
 * with the cover beside the player the card is up to 35rem on computers, and still never wider
 * than the message. Phones keep upstream's full width.
 */

import type React from 'react';

const FORK_AUDIO_CARD_MAX_WIDTH = '35rem';

export function forkAudioCardWidth(isMobile: boolean): React.CSSProperties {
	return isMobile ? {} : {maxWidth: `min(100%, ${FORK_AUDIO_CARD_MAX_WIDTH})`};
}
