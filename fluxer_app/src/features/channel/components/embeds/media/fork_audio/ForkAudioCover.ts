// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: an audio attachment's cover (tyne-chat/tyne#873). The server keeps the cover embedded in an
 * audio upload and flags the attachment, or the audio of a link embed pointing at it; the media
 * proxy serves the cover from the attachment's own URL with `cover=1`, resized like any image.
 */

import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {buildMediaProxyURL, mediaDevicePixelRatio} from '@app/features/messaging/utils/MediaProxyUtils';
import {
	FORK_ATTACHMENT_COVER_PARAMETER,
	ForkMessageAttachmentFlags,
} from '@fluxer/constants/src/ForkAttachmentConstants';
import type {MessageAttachment} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

export function forkAttachmentHasCover(attachment: Pick<MessageAttachment, 'flags'> | null | undefined): boolean {
	return ((attachment?.flags ?? 0) & ForkMessageAttachmentFlags.HAS_COVER) !== 0;
}

/**
 * The URL of the cover of the attachment at `attachmentUrl` (its proxy URL, signed): with `size`,
 * as a WebP that wide in CSS pixels at this screen's density; without, as stored.
 */
export function forkCoverURL(attachmentUrl: string, size?: number): string {
	let url: URL;
	try {
		url = new URL(attachmentUrl);
	} catch {
		return '';
	}
	url.searchParams.set(FORK_ATTACHMENT_COVER_PARAMETER, '1');
	if (size === undefined) return buildMediaProxyURL(url.toString());
	return buildMediaProxyURL(url.toString(), {
		width: Math.ceil(size * mediaDevicePixelRatio()),
		format: 'webp',
	});
}

/** The attachment an audio player shows: the message's own, or one in a forwarded snapshot. */
export function findForkAudioAttachment(
	message: Message | undefined,
	attachmentId: string | undefined,
	snapshotIndex: number | undefined,
): MessageAttachment | undefined {
	if (!message || !attachmentId) return undefined;
	const attachments =
		snapshotIndex === undefined ? message.attachments : message.messageSnapshots?.[snapshotIndex]?.attachments;
	return attachments?.find((attachment) => attachment.id === attachmentId);
}

/**
 * The file name a link to an audio file ends in, decoded, when it has an extension; null otherwise.
 * Upstream names a link's media from its URL without the extension (`deriveDefaultNameFromMessage`),
 * and the player always shows the extension, as the phone app does for a link.
 */
export function forkLinkedFileName(url: string): string | null {
	let path: string;
	try {
		path = new URL(url).pathname;
	} catch {
		return null;
	}
	const last = path.slice(path.lastIndexOf('/') + 1);
	let name: string;
	try {
		name = decodeURIComponent(last);
	} catch {
		return null;
	}
	return name.lastIndexOf('.') > 0 ? name : null;
}

/** What a player reads of the file it plays: its fork flags and, for an attachment, its waveform. */
export interface ForkAudioMedia {
	flags: number;
	waveform: string | null;
}

/**
 * The attachment's flags and waveform; for a link to an audio file (an embed), the embed audio's
 * flags, which say whether the linked attachment's cover and waveform can be loaded.
 */
export function findForkAudioMedia(
	message: Message | undefined,
	attachmentId: string | undefined,
	embedIndex: number | undefined,
	snapshotIndex: number | undefined,
): ForkAudioMedia | undefined {
	const attachment = findForkAudioAttachment(message, attachmentId, snapshotIndex);
	if (attachment) return {flags: attachment.flags ?? 0, waveform: attachment.waveform ?? null};
	if (!message || attachmentId || embedIndex === undefined) return undefined;
	const embeds = snapshotIndex === undefined ? message.embeds : message.messageSnapshots?.[snapshotIndex]?.embeds;
	const audio = embeds?.[embedIndex]?.audio;
	return audio ? {flags: audio.flags ?? 0, waveform: null} : undefined;
}
