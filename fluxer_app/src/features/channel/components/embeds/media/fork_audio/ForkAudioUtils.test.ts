// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	findForkAudioAttachment,
	findForkAudioMedia,
	forkAttachmentHasCover,
	forkCoverURL,
	forkLinkedFileName,
} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioCover';
import {truncateForkName} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioName';
import {
	decodeForkWaveform,
	FORK_WAVEFORM_MIN_BAR,
	forkWaveformBarCount,
	isForkWaveformBarPlayed,
	resampleForkWaveform,
} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioWaveformUtils';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {ForkMessageAttachmentFlags} from '@fluxer/constants/src/ForkAttachmentConstants';
import {describe, expect, it} from 'vitest';

describe('decodeForkWaveform', () => {
	it('reads each byte as a share of 255', () => {
		expect(decodeForkWaveform(btoa(String.fromCharCode(0, 51, 255)))).toEqual([0, 0.2, 1]);
	});

	it('has nothing for a missing or unreadable waveform', () => {
		expect(decodeForkWaveform(null)).toEqual([]);
		expect(decodeForkWaveform('')).toEqual([]);
		expect(decodeForkWaveform('not base64 at all!')).toEqual([]);
	});
});

describe('resampleForkWaveform', () => {
	it('averages the points each bar covers', () => {
		expect(resampleForkWaveform([0.2, 0.4, 0.6, 0.8], 2)).toEqual([expect.closeTo(0.3, 10), expect.closeTo(0.7, 10)]);
	});

	it('splits a point between the bars that share it', () => {
		const bars = resampleForkWaveform([0.2, 1, 0.2], 2);
		expect(bars[0]).toBeCloseTo((0.2 + 0.5 * 1) / 1.5, 10);
		expect(bars[1]).toBeCloseTo((0.5 * 1 + 0.2) / 1.5, 10);
	});

	it('stretches a short waveform over more bars', () => {
		expect(resampleForkWaveform([1, 0.5], 4)).toEqual([1, 1, 0.5, 0.5]);
	});

	it('keeps silence visible as the shortest bar', () => {
		expect(resampleForkWaveform([0, 0], 2)).toEqual([FORK_WAVEFORM_MIN_BAR, FORK_WAVEFORM_MIN_BAR]);
	});

	it('draws nothing from nothing', () => {
		expect(resampleForkWaveform([], 10)).toEqual([]);
		expect(resampleForkWaveform([1], 0)).toEqual([]);
	});
});

describe('forkWaveformBarCount and isForkWaveformBarPlayed', () => {
	it('fits as many bars as the width allows, within the limits', () => {
		expect(forkWaveformBarCount(200, 4)).toBe(50);
		expect(forkWaveformBarCount(10, 4)).toBe(12);
		expect(forkWaveformBarCount(4000, 4)).toBe(120);
		expect(forkWaveformBarCount(0, 4)).toBe(12);
	});

	it('marks a bar played once the playback passes its middle', () => {
		expect(isForkWaveformBarPlayed(0, 4, 12.5)).toBe(true);
		expect(isForkWaveformBarPlayed(1, 4, 30)).toBe(false);
		expect(isForkWaveformBarPlayed(3, 4, 100)).toBe(true);
	});
});

describe('truncateForkName', () => {
	const fitsIn = (characters: number) => (text: string) => text.length <= characters;

	it('keeps a name that fits whole', () => {
		expect(truncateForkName('Spell_Cast_Draft', fitsIn(40))).toBe('Spell_Cast_Draft');
	});

	it('cuts the longest start that fits with the ellipsis', () => {
		expect(truncateForkName('Nightmare_Magic_Cast_Subjugate_Ominous', fitsIn(20))).toBe('Nightmare_Magic_Cas…');
	});

	it('leaves only the ellipsis when nothing else fits', () => {
		expect(truncateForkName('Nightmare', fitsIn(0))).toBe('…');
	});
});

describe('the cover', () => {
	const signed = 'https://media.example/attachments/1/2/Spell.wav?ex=1&is=2&hm=abc';

	it('is served from the attachment URL with cover=1, resized as a WebP when a size is given', () => {
		const resized = new URL(forkCoverURL(signed, 148));
		expect(resized.pathname).toBe('/attachments/1/2/Spell.wav');
		expect(resized.searchParams.get('cover')).toBe('1');
		expect(resized.searchParams.get('format')).toBe('webp');
		expect(Number(resized.searchParams.get('width'))).toBeGreaterThanOrEqual(148);
		expect(resized.searchParams.get('hm')).toBe('abc');
		const original = new URL(forkCoverURL(signed));
		expect(original.searchParams.get('cover')).toBe('1');
		expect(original.searchParams.get('width')).toBeNull();
	});

	it('exists only for an attachment the server flagged', () => {
		expect(forkAttachmentHasCover({flags: ForkMessageAttachmentFlags.HAS_COVER | 8})).toBe(true);
		expect(forkAttachmentHasCover({flags: 8})).toBe(false);
		expect(forkAttachmentHasCover(undefined)).toBe(false);
	});

	it('belongs to the attachment of the message, or to one in a forwarded snapshot', () => {
		const message = {
			attachments: [{id: 'a', filename: 'a.wav'}],
			messageSnapshots: [{attachments: [{id: 'b', filename: 'b.wav'}]}],
		} as unknown as Message;
		expect(findForkAudioAttachment(message, 'a', undefined)?.filename).toBe('a.wav');
		expect(findForkAudioAttachment(message, 'b', 0)?.filename).toBe('b.wav');
		expect(findForkAudioAttachment(message, 'b', undefined)).toBeUndefined();
		expect(findForkAudioAttachment(undefined, 'a', undefined)).toBeUndefined();
	});

	it('names a link after the file it points at, extension included', () => {
		expect(forkLinkedFileName('https://media.example/attachments/1/2/Spell_Cast%20Draft.wav?ex=1')).toBe(
			'Spell_Cast Draft.wav',
		);
		expect(forkLinkedFileName('https://example.com/stream')).toBeNull();
		expect(forkLinkedFileName('https://example.com/.hidden')).toBeNull();
		expect(forkLinkedFileName('not a url')).toBeNull();
	});

	it("is read from an attachment's flags, or from a link embed's audio flags", () => {
		const {HAS_COVER, HAS_WAVEFORM} = ForkMessageAttachmentFlags;
		const message = {
			attachments: [{id: 'a', filename: 'a.wav', flags: HAS_COVER, waveform: 'AAEC'}],
			embeds: [{type: 'image'}, {type: 'audio', audio: {url: 'x', flags: HAS_COVER | HAS_WAVEFORM}}],
			messageSnapshots: [{attachments: [], embeds: [{type: 'audio', audio: {url: 'y', flags: HAS_WAVEFORM}}]}],
		} as unknown as Message;
		expect(findForkAudioMedia(message, 'a', undefined, undefined)).toEqual({flags: HAS_COVER, waveform: 'AAEC'});
		expect(findForkAudioMedia(message, undefined, 1, undefined)).toEqual({
			flags: HAS_COVER | HAS_WAVEFORM,
			waveform: null,
		});
		expect(findForkAudioMedia(message, undefined, 0, 0)).toEqual({flags: HAS_WAVEFORM, waveform: null});
		expect(findForkAudioMedia(message, undefined, 0, undefined)).toBeUndefined();
		expect(findForkAudioMedia(message, 'missing', 1, undefined)).toBeUndefined();
	});
});
