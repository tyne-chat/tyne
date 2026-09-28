// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the message a reaction picker reacts to, read by the persona selector and the quick reaction
// menu. It lives here, not in EmojiPicker.tsx, because upstream's builds swap that module for a lazy
// stand-in that exports only the picker (the alias list in fluxer_app/rspack.config.mjs).

import {createContext} from 'react';

export interface EmojiPickerReactionContextValue {
	channelId?: string;
	messageId?: string;
}

export const EmojiPickerReactionContext = createContext<EmojiPickerReactionContextValue | null>(null);
