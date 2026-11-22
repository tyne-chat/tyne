// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fork: a link to an audio attachment on this instance gets the audio player's cover and waveform
 * (tyne-chat/tyne#873).
 *
 * A pasted link (an audio attachment's "Copy link") becomes a link embed, not an attachment, so it
 * has none of the attachment's cover flag or waveform. For an embed whose audio is an attachment on
 * this instance (its URL names `attachments/<channel>/<attachment>/<file>` on the media endpoint),
 * this looks up the two objects the attachment's upload stored (`ForkAudioExtras.ts`) and flags the
 * embed's audio: `HAS_COVER` when its cover exists, `HAS_WAVEFORM` when its waveform does. The apps
 * read them from the link's own URL, with `cover=1` and `waveform=1`.
 *
 * Nothing is decoded here: an embed costs two storage lookups when its message is created or edited,
 * and a lookup that fails leaves that flag off.
 */
import {Config} from '@app/api/Config';
import {forkAttachmentCoverKey, forkAttachmentWaveformKey} from '@app/api/channel/services/message/ForkAudioExtras';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';
import {Logger} from '@app/api/Logger';
import {getStorageService} from '@app/api/middleware/ServiceSingletons';
import {ForkMessageAttachmentFlags} from '@fluxer/constants/src/ForkAttachmentConstants';
import type {MessageEmbedResponse} from '@fluxer/schema/src/domains/message/EmbedSchemas';
import {attachmentStorageKeyFromUrl} from '@pkgs/media_proxy_utils/src/AttachmentUrlSignature';

const SNOWFLAKE = /^[0-9]{1,20}$/u;

/** The channel and attachment a URL to an attachment on this instance names, or null. */
export function forkLinkedAttachment(url: string): {channelId: bigint; attachmentId: bigint} | null {
	const key = attachmentStorageKeyFromUrl(url, Config.endpoints.media);
	if (key === null) return null;
	const [prefix, channelId, attachmentId] = key.replace(/^\/+/u, '').split('/');
	if (prefix !== 'attachments' || !SNOWFLAKE.test(channelId ?? '') || !SNOWFLAKE.test(attachmentId ?? '')) {
		return null;
	}
	return {channelId: BigInt(channelId!), attachmentId: BigInt(attachmentId!)};
}

/** Flags the audio of `embeds` that links to an attachment here with its cover and waveform. */
export async function forkFlagLinkedAudioExtras(
	embeds: Array<MessageEmbedResponse>,
	storageService?: IStorageService,
): Promise<void> {
	await Promise.all(
		embeds.map(async (embed) => {
			const audio = embed.audio;
			if (!audio) return;
			const linked = forkLinkedAttachment(audio.url);
			if (!linked) return;
			// Taken only here, so that embeds of anything else never reach storage.
			const storage = storageService ?? getStorageService();
			const [hasCover, hasWaveform] = await Promise.all([
				stored(storage, forkAttachmentCoverKey(linked.channelId, linked.attachmentId)),
				stored(storage, forkAttachmentWaveformKey(linked.channelId, linked.attachmentId)),
			]);
			let flags = audio.flags ?? 0;
			if (hasCover) flags |= ForkMessageAttachmentFlags.HAS_COVER;
			if (hasWaveform) flags |= ForkMessageAttachmentFlags.HAS_WAVEFORM;
			embed.audio = {...audio, flags};
		}),
	);
}

async function stored(storage: IStorageService, key: string): Promise<boolean> {
	try {
		return (await storage.getObjectMetadata(Config.s3.buckets.cdn, key)) !== null;
	} catch (error) {
		Logger.warn({error, key}, 'Linked audio attachment: could not look up its cover or waveform');
		return false;
	}
}
