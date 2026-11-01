// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Gif} from '@app/features/expressions/commands/GifCommands';
import type {FavoriteMeme} from '@app/features/expressions/models/FavoriteMeme';
import type {GuildSticker} from '@app/features/expressions/models/GuildSticker';
import * as GifSlugUtils from '@app/features/expressions/utils/GifSlugUtils';
import {UploadingAttachment} from '@app/features/messaging/models/UploadingAttachment';
import AttachmentUrlRefresher from '@app/features/messaging/state/AttachmentUrlRefresher';
import {isApiAttachmentUrl} from '@app/features/messaging/utils/ApiAttachmentUrl';
import {attachmentUrlMayNeedRefresh} from '@app/features/messaging/utils/AttachmentCdnUrl';
import {TextareaSegmentManager} from '@app/features/messaging/utils/TextareaSegmentManager';
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import ActiveComposer from '@app/features/threads/state/ActiveComposer';
import Users from '@app/features/user/state/Users';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import type {MessageAttachment, MessageStickerItem} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {useCallback, useEffect} from 'react';

// Fork imports.

import {insertMentionInInlineEdit} from '@app/features/channel/components/useInlineEditCaret';
import type {ComposerHandle} from '@app/features/lexical/composer/ComposerHandle';
import {insertComposerMention} from '@app/features/lexical/composer/ComposerInsertion';
import {
	clearComposerAfterExpression,
	isDraftUsedUpByExpression,
} from '@app/features/messaging/utils/ExpressionDraftPersona';
import {type MentionPersona, personaMentionText} from '@app/features/messaging/utils/MentionInsert';

interface UseTextareaExpressionHandlersOptions {
	setValue: React.Dispatch<React.SetStateAction<string>>;
	previousValueRef: React.RefObject<string>;
	segmentManagerRef: React.RefObject<TextareaSegmentManager>;
	sendOptimisticMessage: (
		messageData: {
			content: string;
			stickers?: Array<MessageStickerItem>;
			attachments?: Array<MessageAttachment>;
		},
		sendOptions: {
			hasAttachments: boolean;
			favoriteMemeId?: string;
			draftOverride?: string;
		},
	) => void;
	clearComposer?: () => void;
	enabled?: boolean;
	channelId?: string;
	composerHandleRef?: React.RefObject<ComposerHandle | null>;
}

export const useTextareaExpressionHandlers = ({
	setValue,
	previousValueRef,
	segmentManagerRef,
	sendOptimisticMessage,
	clearComposer,
	enabled = true,
	channelId,
	composerHandleRef,
}: UseTextareaExpressionHandlersOptions) => {
	const appendText = useCallback(
		(text: string) => {
			if (!enabled || (channelId != null && !ActiveComposer.accepts(channelId))) return;
			const prevValue = previousValueRef.current;
			const prefix = prevValue.length === 0 ? '' : ' ';
			const nextValue = `${prevValue}${prefix}${text} `;
			segmentManagerRef.current.setSegments(segmentManagerRef.current.getSegmentsCopy());
			previousValueRef.current = nextValue;
			setValue(nextValue);
		},
		[enabled, channelId, previousValueRef, segmentManagerRef, setValue],
	);
	useEffect(() => {
		const handleGifSelect = async (payload?: unknown) => {
			if (!enabled || (channelId != null && !ActiveComposer.accepts(channelId))) return;
			const {gif, autoSend} = (payload ?? {}) as {
				gif?: Gif;
				autoSend?: boolean;
			};
			if (!gif) return;
			const shareUrl = GifSlugUtils.resolveShareUrl(gif.provider, {url: gif.url, slug: gif.slug});
			const gifUrl = attachmentUrlMayNeedRefresh(shareUrl, Date.now())
				? await AttachmentUrlRefresher.refresh(shareUrl)
				: shareUrl;
			if (channelId != null && !ActiveComposer.accepts(channelId)) return;
			if (autoSend) {
				const currentDraft = previousValueRef.current || '';
				const draftUsedUp = isDraftUsedUpByExpression(channelId ?? null, currentDraft);
				sendOptimisticMessage({content: gifUrl}, {hasAttachments: false, draftOverride: currentDraft});
				clearComposerAfterExpression(draftUsedUp, clearComposer, setValue);
			} else {
				appendText(gifUrl);
			}
		};
		return ComponentBus.subscribe('GIF_SELECT', (payload) => {
			void handleGifSelect(payload);
		});
	}, [appendText, sendOptimisticMessage, setValue, clearComposer, enabled, previousValueRef, channelId]);
	useEffect(() => {
		const handleStickerSelect = (payload?: unknown) => {
			if (!enabled || (channelId != null && !ActiveComposer.accepts(channelId))) return;
			const {sticker} = (payload ?? {}) as {
				sticker?: GuildSticker;
			};
			if (!sticker) return;
			const currentDraft = previousValueRef.current || '';
			const draftUsedUp = isDraftUsedUpByExpression(channelId ?? null, currentDraft);
			sendOptimisticMessage(
				{content: '', stickers: [sticker.toJSON()]},
				{hasAttachments: false, draftOverride: currentDraft},
			);
			clearComposerAfterExpression(draftUsedUp, clearComposer, setValue);
		};
		return ComponentBus.subscribe('STICKER_SELECT', handleStickerSelect);
	}, [sendOptimisticMessage, setValue, clearComposer, enabled, previousValueRef, channelId]);
	useEffect(() => {
		const handleFavoriteMemeSelect = (payload?: unknown) => {
			if (!enabled || (channelId != null && !ActiveComposer.accepts(channelId))) return;
			const {meme, autoSend} = (payload ?? {}) as {
				meme?: FavoriteMeme;
				autoSend?: boolean;
			};
			if (!meme) return;
			const insertMemeUrl = async () => {
				appendText(await AttachmentUrlRefresher.refresh(meme.url));
			};
			const providerShareUrl =
				meme.gifProvider && meme.gifSlug ? GifSlugUtils.buildShareUrl(meme.gifProvider, meme.gifSlug) : null;
			if (providerShareUrl) {
				if (autoSend) {
					const currentDraft = previousValueRef.current || '';
					const draftUsedUp = isDraftUsedUpByExpression(channelId ?? null, currentDraft);
					sendOptimisticMessage({content: providerShareUrl}, {hasAttachments: false, draftOverride: currentDraft});
					clearComposerAfterExpression(draftUsedUp, clearComposer, setValue);
				} else {
					appendText(providerShareUrl);
				}
			} else if (autoSend || isApiAttachmentUrl(meme.url)) {
				const currentDraft = previousValueRef.current || '';
				const draftUsedUp = isDraftUsedUpByExpression(channelId ?? null, currentDraft);
				const uploadingAttachment = UploadingAttachment.fromDescriptor({
					filename: meme.filename,
					title: meme.name,
					size: meme.size,
					contentType: meme.contentType,
				}).toJSON();
				sendOptimisticMessage(
					{content: '', attachments: [uploadingAttachment]},
					{hasAttachments: false, favoriteMemeId: meme.id, draftOverride: currentDraft},
				);
				clearComposerAfterExpression(draftUsedUp, clearComposer, setValue);
			} else {
				void insertMemeUrl();
			}
		};
		return ComponentBus.subscribe('FAVORITE_MEME_SELECT', handleFavoriteMemeSelect);
	}, [appendText, sendOptimisticMessage, setValue, clearComposer, enabled, previousValueRef, channelId]);
	useEffect(() => {
		const handleInsertMention = (payload?: unknown) => {
			if (!enabled || (channelId != null && !ActiveComposer.accepts(channelId))) return;
			const {userId, persona} = (payload ?? {}) as {
				userId?: string;
				persona?: MentionPersona | null;
			};
			if (!userId) return;
			const user = Users.getUser(userId);
			if (!user) {
				return;
			}
			const prevValue = previousValueRef.current;
			const {display: displayText, wire: actualText} =
				persona != null
					? personaMentionText(userId, persona)
					: {display: `@${NicknameUtils.formatUserTagForStreamerMode(user)}`, wire: `<@${userId}>`};
			// Fork: a mention goes to the caret, in the inline edit if that holds it, else in the composer
			// (tyne-chat/tyne#287, tyne-chat/tyne#296). Upstream's lines below append to the end.
			const mention = {id: userId, display: displayText, wire: actualText};
			if (channelId != null && insertMentionInInlineEdit(channelId, mention)) {
				return;
			}
			const composerHandle = composerHandleRef?.current ?? null;
			if (insertComposerMention(composerHandle, mention)) {
				composerHandle?.focus();
				return;
			}
			const needsSpace = prevValue.length > 0 && !prevValue.endsWith(' ');
			const prefix = needsSpace ? ' ' : '';
			const insertPosition = prevValue.length + prefix.length;
			const segmentManager = new TextareaSegmentManager();
			segmentManager.setSegments(segmentManagerRef.current.getSegmentsCopy());
			const {newText} = segmentManager.insertSegment(
				prevValue + prefix,
				insertPosition,
				displayText,
				actualText,
				'user',
				userId,
			);
			segmentManagerRef.current.setSegments(segmentManager.getSegmentsCopy());
			previousValueRef.current = newText;
			setValue(newText);
		};
		return ComponentBus.subscribe('INSERT_MENTION', handleInsertMention);
	}, [previousValueRef, setValue, segmentManagerRef, enabled, channelId, composerHandleRef]);
};
