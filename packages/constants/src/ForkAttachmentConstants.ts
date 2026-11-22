// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: attachment and embed media flag bits of the fork's own (tyne-chat/tyne#873). They sit in the
 * middle of the Int32 range: upstream numbers its documented flags up from the bottom (`IS_SPOILER`
 * is `1 << 3`) and its internal ones down from the top (`EMBED_MEDIA_OWNED_ATTACHMENT_FLAG`, which
 * decides whether deleting a message deletes an embed's file, is `1 << 30`), so neither end is safe
 * (root `AGENTS.md`, "Numbers upstream hands out"). `ForkFlagBits.test.ts` in the API fails the day
 * upstream takes one. They live here rather than in upstream's `MessageAttachmentFlags`, which the
 * API documents; the response schemas pass unknown bits through, and clients only ever read these.
 *
 * - `HAS_COVER`: an audio attachment whose embedded cover the server kept; the cover is served from
 *   the attachment's own URL with `cover=1`. Only the server sets it: the API keeps no flag a client
 *   sends except spoiler and explicit.
 * - `HAS_WAVEFORM`: on the audio media of a link embed only, a link to an audio attachment on this
 *   instance whose waveform is served from the link with `waveform=1` (an attachment carries its
 *   waveform itself). `HAS_COVER` on such media marks the linked attachment's cover.
 */
export const ForkMessageAttachmentFlags = {
	HAS_COVER: 1 << 21,
	HAS_WAVEFORM: 1 << 20,
} as const;

/** The query parameter that serves an attachment's cover instead of the file (tyne-chat/tyne#873). */
export const FORK_ATTACHMENT_COVER_PARAMETER = 'cover';

/** The query parameter that serves an attachment's waveform instead of the file (tyne-chat/tyne#873). */
export const FORK_ATTACHMENT_WAVEFORM_PARAMETER = 'waveform';
