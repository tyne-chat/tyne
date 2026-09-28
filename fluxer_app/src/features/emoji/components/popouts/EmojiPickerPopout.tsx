// SPDX-License-Identifier: AGPL-3.0-or-later

import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import {ExpressionPickerPopout} from '@app/features/expressions/components/popouts/ExpressionPickerPopout';
import {observer} from 'mobx-react-lite';
import {useCallback} from 'react';

export const EmojiPickerPopout = observer(
	({
		channelId,
		messageId,
		handleSelect,
		onClose,
		filterEmoji,
	}: {
		channelId: string | null;
		messageId?: string;
		handleSelect: (emoji: FlatEmoji, shiftKey?: boolean) => void;
		onClose?: () => void;
		filterEmoji?: (emoji: FlatEmoji) => boolean;
	}) => {
		const handleEmojiSelect = useCallback(
			(emoji: FlatEmoji, shiftKey?: boolean) => {
				handleSelect(emoji, shiftKey);
				if (!shiftKey && onClose) {
					onClose();
				}
			},
			[handleSelect, onClose],
		);
		return (
			<ExpressionPickerPopout
				channelId={channelId ?? undefined}
				messageId={messageId}
				onEmojiSelect={handleEmojiSelect}
				onClose={onClose}
				visibleTabs={['emojis']}
				filterEmoji={filterEmoji}
				data-flx="emoji.emoji-picker-popout.expression-picker-popout"
			/>
		);
	},
);
