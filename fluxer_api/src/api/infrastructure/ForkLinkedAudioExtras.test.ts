// SPDX-License-Identifier: AGPL-3.0-or-later
import {Config} from '@app/api/Config';
import {forkAttachmentCoverKey, forkAttachmentWaveformKey} from '@app/api/channel/services/message/ForkAudioExtras';
import {forkFlagLinkedAudioExtras, forkLinkedAttachment} from '@app/api/infrastructure/ForkLinkedAudioExtras';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';
import {EmbedMediaFlags} from '@fluxer/constants/src/ChannelConstants';
import {ForkMessageAttachmentFlags} from '@fluxer/constants/src/ForkAttachmentConstants';
import type {MessageEmbedResponse} from '@fluxer/schema/src/domains/message/EmbedSchemas';
import {describe, expect, it} from 'vitest';

const {HAS_COVER, HAS_WAVEFORM} = ForkMessageAttachmentFlags;

/** Storage holding the given keys, counting the lookups. */
function storageWith(keys: Array<string>, fail = false): IStorageService & {lookups: Array<string>} {
	const lookups: Array<string> = [];
	return {
		lookups,
		async getObjectMetadata(_bucket: string, key: string) {
			lookups.push(key);
			if (fail) throw new Error('storage unavailable');
			return keys.includes(key) ? {contentLength: 4, contentType: 'application/octet-stream'} : null;
		},
	} as unknown as IStorageService & {lookups: Array<string>};
}

function audioEmbed(url: string, flags = 0): MessageEmbedResponse {
	return {type: 'audio', url, audio: {url, content_type: 'audio/wav', flags}} as MessageEmbedResponse;
}

const LINK = `${Config.endpoints.media}/attachments/11/22/Spell.wav?ex=1&is=2&hm=abc`;

describe('Links to audio attachments get their cover and waveform (tyne-chat/tyne#873)', () => {
	it('reads the channel and attachment of a link to an attachment here, and nothing else', () => {
		expect(forkLinkedAttachment(LINK)).toEqual({channelId: 11n, attachmentId: 22n});
		expect(forkLinkedAttachment('https://elsewhere.example/attachments/11/22/Spell.wav')).toBeNull();
		expect(forkLinkedAttachment(`${Config.endpoints.media}/emojis/11/22/x.png`)).toBeNull();
	});

	it('flags the cover and the waveform that are stored, keeping the other flags, with two lookups', async () => {
		const storage = storageWith([forkAttachmentCoverKey(11n, 22n), forkAttachmentWaveformKey(11n, 22n)]);
		const embeds = [audioEmbed(LINK, EmbedMediaFlags.CONTAINS_EXPLICIT_MEDIA)];

		await forkFlagLinkedAudioExtras(embeds, storage);

		expect(embeds[0]!.audio!.flags).toBe(EmbedMediaFlags.CONTAINS_EXPLICIT_MEDIA | HAS_COVER | HAS_WAVEFORM);
		expect(storage.lookups).toHaveLength(2);
	});

	it('flags only what is stored', async () => {
		const embeds = [audioEmbed(LINK)];
		await forkFlagLinkedAudioExtras(embeds, storageWith([forkAttachmentWaveformKey(11n, 22n)]));
		expect(embeds[0]!.audio!.flags).toBe(HAS_WAVEFORM);
	});

	it('leaves other embeds alone without asking storage', async () => {
		const storage = storageWith([]);
		const image = {type: 'image', url: LINK, image: {url: LINK, flags: 0}} as MessageEmbedResponse;
		const elsewhere = audioEmbed('https://elsewhere.example/attachments/11/22/Spell.wav');

		await forkFlagLinkedAudioExtras([image, elsewhere], storage);

		expect(elsewhere.audio!.flags).toBe(0);
		expect(storage.lookups).toHaveLength(0);
	});

	it('leaves the flags off when storage cannot answer', async () => {
		const embeds = [audioEmbed(LINK)];
		await forkFlagLinkedAudioExtras(embeds, storageWith([], true));
		expect(embeds[0]!.audio!.flags).toBe(0);
	});
});
