// SPDX-License-Identifier: AGPL-3.0-or-later

import {createHash} from 'node:crypto';
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {Config} from '@app/api/Config';
import {
	FORK_ANIMATED_AVIF_CONVERSION_PATH,
	startsAsAnimatedAvif,
	webpFilename,
} from '@app/api/channel/services/message/ForkAnimatedAvifConversion';
import {makeAttachmentCdnKey} from '@app/api/channel/services/message/MessageHelpers';
import {createChannel, createGuild, sendMessageWithAttachments} from '@app/api/channel/tests/AttachmentTestUtils';
import {fileShaCache} from '@app/api/middleware/FileShaCache';
import {setInjectedMediaService} from '@app/api/middleware/ServiceRegistry';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {server} from '@app/api/test/msw/server';
import {TestMediaService} from '@app/api/test/TestMediaService';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {HttpResponse, http} from 'msw';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

/** An `ftyp` box with these brands, then `filler` bytes standing in for the rest of the file. */
function ftyp(major: string, compatible: Array<string>, filler = 64): Buffer {
	const size = 16 + compatible.length * 4;
	const box = Buffer.alloc(size);
	box.writeUInt32BE(size, 0);
	box.write('ftyp', 4, 'latin1');
	box.write(major, 8, 'latin1');
	compatible.forEach((brand, index) => box.write(brand, 16 + index * 4, 'latin1'));
	return Buffer.concat([box, Buffer.alloc(filler, 0x2a)]);
}

/** As FFmpeg's `avif` muxer and libavif write an animated AVIF. */
const ANIMATED_AVIF = ftyp('avis', ['avis', 'avif', 'msf1', 'iso8', 'mif1', 'miaf', 'MA1B']);
const LIBAVIF_ANIMATED_AVIF = ftyp('avif', ['avif', 'avis', 'msf1', 'iso8', 'mif1', 'miaf', 'MA1B']);
const STILL_AVIF = ftyp('avif', ['avif', 'mif1', 'miaf', 'MA1B']);
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8X', 'latin1'), Buffer.alloc(32, 7)]);

interface RecordedConversion {
	authorization: string | null;
	body: {type: string; bucket: string; key: string};
}

function conversionEndpoint(): string {
	return `http://${Config.mediaProxy.host}:${Config.mediaProxy.port}${FORK_ANIMATED_AVIF_CONVERSION_PATH}`;
}

function recordConversions(respond: () => Response): Array<RecordedConversion> {
	const requests: Array<RecordedConversion> = [];
	server.use(
		http.post(conversionEndpoint(), async ({request}) => {
			requests.push({
				authorization: request.headers.get('authorization'),
				body: (await request.json()) as RecordedConversion['body'],
			});
			return respond();
		}),
	);
	return requests;
}

function convertedResponse(): Response {
	return new HttpResponse(WEBP_BYTES, {
		status: 200,
		headers: {
			'Content-Type': 'image/webp',
			'x-fluxer-media-width': '64',
			'x-fluxer-media-height': '48',
			'x-tyne-animation-frames': '4',
		},
	});
}

describe('startsAsAnimatedAvif', () => {
	it('takes the avis brand as the major brand or among the compatible ones', () => {
		expect(startsAsAnimatedAvif(ANIMATED_AVIF)).toBe(true);
		expect(startsAsAnimatedAvif(LIBAVIF_ANIMATED_AVIF)).toBe(true);
		expect(startsAsAnimatedAvif(ftyp('avis', ['avis', 'av01', 'iso2', 'mp41']))).toBe(true);
	});

	it('leaves still AVIF, other ISO files and short or foreign data alone', () => {
		expect(startsAsAnimatedAvif(STILL_AVIF)).toBe(false);
		expect(startsAsAnimatedAvif(ftyp('isom', ['isom', 'iso2', 'avc1', 'mp41']))).toBe(false);
		expect(startsAsAnimatedAvif(ftyp('heic', ['mif1', 'heic']))).toBe(false);
		expect(startsAsAnimatedAvif(Buffer.from('GIF89a'))).toBe(false);
		expect(startsAsAnimatedAvif(ANIMATED_AVIF.subarray(0, 12))).toBe(false);
	});

	it('reads brands only inside the ftyp box', () => {
		const box = ftyp('avif', ['avif', 'mif1'], 0);
		expect(startsAsAnimatedAvif(Buffer.concat([box, Buffer.from('avisavis', 'latin1')]))).toBe(false);
	});
});

describe('webpFilename', () => {
	it('replaces the last extension, or adds one', () => {
		expect(webpFilename('mlem.avif')).toBe('mlem.webp');
		expect(webpFilename('Clip.AVIF')).toBe('Clip.webp');
		expect(webpFilename('a.b.avif')).toBe('a.b.webp');
		expect(webpFilename('noextension')).toBe('noextension.webp');
		expect(webpFilename('.hidden')).toBe('.hidden.webp');
	});
});

describe('Animated AVIF attachments become animated WebP (tyne-chat/tyne#854)', () => {
	let harness: ApiTestHarness;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	beforeEach(async () => {
		await harness.reset();
		setInjectedMediaService(new TestMediaService(harness.storageService));
	});

	async function send(filename: string, data: Buffer) {
		const account = await createTestAccount(harness);
		const guild = await createGuild(harness, account.token, 'Animated AVIF Guild');
		const channel = await createChannel(harness, account.token, guild.id, 'avif');
		const channelId = guild.system_channel_id ?? channel.id;
		const result = await sendMessageWithAttachments(
			harness,
			account.token,
			channelId,
			{content: 'animated', attachments: [{id: 0, filename}]},
			[{index: 0, filename, data}],
		);
		return {...result, channelId};
	}

	async function storedBytes(channelId: string, attachment: {id: string; filename: string}): Promise<Buffer> {
		const key = makeAttachmentCdnKey(BigInt(channelId) as never, BigInt(attachment.id), attachment.filename);
		return Buffer.from(await harness.storageService.readObject(Config.s3.buckets.cdn, key));
	}

	it('stores the WebP the media proxy returns, under a .webp name, with one request', async () => {
		const requests = recordConversions(convertedResponse);
		const {response, json, channelId} = await send('mlem.avif', ANIMATED_AVIF);

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
		expect(requests[0]!.authorization).toBe(`Bearer ${Config.mediaProxy.secretKey}`);
		expect(requests[0]!.body).toMatchObject({type: 's3', bucket: Config.s3.buckets.uploads});
		const [attachment] = json.attachments!;
		expect(attachment!.filename).toBe('mlem.webp');
		expect(await storedBytes(channelId, attachment!)).toEqual(WEBP_BYTES);
	});

	it('refuses the message when the media proxy says the animation is too large', async () => {
		const requests = recordConversions(() => new HttpResponse('Payload Too Large', {status: 413}));
		const {response, json} = await send('long.avif', ANIMATED_AVIF);

		expect(requests).toHaveLength(1);
		expect(response.status).toBe(400);
		expect((json as unknown as {code: string}).code).toBe(APIErrorCodes.ANIMATION_TOO_LARGE_TO_CONVERT);
	});

	it('keeps the upload as it is when the conversion fails, without asking again', async () => {
		const requests = recordConversions(() => new HttpResponse('Bad Request', {status: 400}));
		const {response, json, channelId} = await send('broken.avif', ANIMATED_AVIF);

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
		const [attachment] = json.attachments!;
		expect(attachment!.filename).toBe('broken.avif');
		expect(await storedBytes(channelId, attachment!)).toEqual(ANIMATED_AVIF);
	});

	it('sends nothing to the media proxy for a still AVIF or another image', async () => {
		const requests = recordConversions(convertedResponse);
		const still = await send('still.avif', STILL_AVIF);
		const gif = await send('loop.gif', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'));

		expect(still.response.status).toBe(200);
		expect(gif.response.status).toBe(200);
		expect(requests).toHaveLength(0);
		expect(still.json.attachments![0]!.filename).toBe('still.avif');
	});

	it('checks the original against the moderation hash list before converting it', async () => {
		const requests = recordConversions(convertedResponse);
		const blocked = createHash('sha256').update(ANIMATED_AVIF).digest('hex');
		fileShaCache.add(blocked);
		try {
			const {response, json} = await send('blocked.avif', ANIMATED_AVIF);
			expect(response.status).toBe(403);
			expect((json as unknown as {code: string}).code).toBe(APIErrorCodes.CONTENT_BLOCKED);
			expect(requests).toHaveLength(0);
		} finally {
			fileShaCache.remove(blocked);
		}
	});
});
