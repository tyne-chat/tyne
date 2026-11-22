// SPDX-License-Identifier: AGPL-3.0-or-later
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {Config} from '@app/api/Config';
import {
	FORK_AUDIO_EXTRAS_PATH,
	forkAttachmentCoverKey,
	forkAttachmentExtraKeys,
	forkAttachmentWaveformKey,
	forkMayHaveCover,
} from '@app/api/channel/services/message/ForkAudioExtras';
import {
	createChannel,
	createGuild,
	loadFixture,
	sendMessageWithAttachments,
} from '@app/api/channel/tests/AttachmentTestUtils';
import type {MediaProxyMetadataRequest, MediaProxyMetadataResponse} from '@app/api/infrastructure/IMediaService';
import {setInjectedMediaService} from '@app/api/middleware/ServiceRegistry';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {server} from '@app/api/test/msw/server';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {TestMediaService} from '@app/api/test/TestMediaService';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {createFavoriteMemeFromMessage} from '@app/api/user/tests/FavoriteMemeTestUtils';
import {MessageReferenceTypes} from '@fluxer/constants/src/ChannelConstants';
import {ForkMessageAttachmentFlags} from '@fluxer/constants/src/ForkAttachmentConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {HttpResponse, http} from 'msw';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const COVER = loadFixture('yeah.png');
const WAVEFORM = Buffer.from([0, 64, 255, 128]).toString('base64');
/** Bytes standing in for a WAV file; the media proxy is answered by the test, not run. */
const AUDIO = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(64, 1)]);

/**
 * The test media service, reading a `.wav` upload or stored file as audio (as the media proxy does;
 * the test service guesses from the key) and with the NSFW verdict on a checked cover chosen by the
 * test.
 */
class CoverCheckingMediaService extends TestMediaService {
	coverVerdict: 'clean' | 'explicit' = 'clean';

	override async getMetadata(request: MediaProxyMetadataRequest): Promise<MediaProxyMetadataResponse | null> {
		const metadata = await super.getMetadata(request);
		if (!metadata) return metadata;
		if (request.type === 'base64') {
			return {...metadata, nsfw: this.coverVerdict === 'explicit'};
		}
		if (
			(request.type === 'upload' && request.filename?.endsWith('.wav')) ||
			(request.type === 's3' && request.key.endsWith('.wav'))
		) {
			return {...metadata, format: 'wav', content_type: 'audio/wav', width: undefined, height: undefined};
		}
		return metadata;
	}
}

interface RecordedRequest {
	authorization: string | null;
	body: {type: string; bucket: string; key: string};
}

function recordExtras(respond: () => Response): Array<RecordedRequest> {
	const requests: Array<RecordedRequest> = [];
	server.use(
		http.post(
			`http://${Config.mediaProxy.host}:${Config.mediaProxy.port}${FORK_AUDIO_EXTRAS_PATH}`,
			async ({request}) => {
				requests.push({
					authorization: request.headers.get('authorization'),
					body: (await request.json()) as RecordedRequest['body'],
				});
				return respond();
			},
		),
	);
	return requests;
}

function extrasResponse(): Response {
	return HttpResponse.json({
		waveform: WAVEFORM,
		cover: {base64: COVER.toString('base64'), content_type: 'image/png', width: 64, height: 64},
	});
}

describe('Audio attachments get a cover and a waveform (tyne-chat/tyne#873)', () => {
	let harness: ApiTestHarness;
	let mediaService: CoverCheckingMediaService;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});
	beforeEach(async () => {
		await harness.reset();
		mediaService = new CoverCheckingMediaService(harness.storageService);
		setInjectedMediaService(mediaService);
	});

	async function send(filename: string, data: Buffer, attachment: Record<string, unknown> = {}) {
		const account = await createTestAccount(harness);
		const guild = await createGuild(harness, account.token, 'Audio Guild');
		const channel = await createChannel(harness, account.token, guild.id, 'audio');
		const channelId = guild.system_channel_id ?? channel.id;
		const result = await sendMessageWithAttachments(
			harness,
			account.token,
			channelId,
			{content: 'listen', attachments: [{id: 0, filename, ...attachment}]},
			[{index: 0, filename, data}],
		);
		return {...result, channelId, account, guildId: guild.id};
	}

	async function storedObject(key: string): Promise<Buffer | null> {
		try {
			return Buffer.from(await harness.storageService.readObject(Config.s3.buckets.cdn, key));
		} catch {
			return null;
		}
	}

	function storedCover(channelId: string, attachmentId: string): Promise<Buffer | null> {
		return storedObject(forkAttachmentCoverKey(BigInt(channelId), BigInt(attachmentId)));
	}

	/** The waveform stored for links to the attachment, as base64 like the attachment's own. */
	async function storedWaveform(channelId: string, attachmentId: string): Promise<string | null> {
		const bytes = await storedObject(forkAttachmentWaveformKey(BigInt(channelId), BigInt(attachmentId)));
		return bytes ? bytes.toString('base64') : null;
	}

	it('stores the cover, flags the attachment and fills in the waveform, with one request', async () => {
		const requests = recordExtras(extrasResponse);
		const {response, json, channelId} = await send('Spell.wav', AUDIO);

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
		expect(requests[0]!.authorization).toBe(`Bearer ${Config.mediaProxy.secretKey}`);
		expect(requests[0]!.body).toMatchObject({type: 's3', bucket: Config.s3.buckets.uploads});
		const [attachment] = json.attachments!;
		expect(attachment!.flags! & ForkMessageAttachmentFlags.HAS_COVER).not.toBe(0);
		expect(attachment!.waveform).toBe(WAVEFORM);
		expect(await storedCover(channelId, attachment!.id)).toEqual(COVER);
		expect(await storedWaveform(channelId, attachment!.id)).toBe(WAVEFORM);
	});

	it('asks the media proxy nothing for an attachment that is not audio', async () => {
		const requests = recordExtras(extrasResponse);
		const {response, json, channelId} = await send('yeah.png', COVER);

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(0);
		const [attachment] = json.attachments!;
		expect((attachment!.flags ?? 0) & ForkMessageAttachmentFlags.HAS_COVER).toBe(0);
		expect(await storedCover(channelId, attachment!.id)).toBeNull();
	});

	it('sends the audio without a cover or waveform when the media proxy cannot read it', async () => {
		const requests = recordExtras(() => new HttpResponse('Bad Request', {status: 400}));
		const {response, json, channelId} = await send('broken.wav', AUDIO);

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
		const [attachment] = json.attachments!;
		expect((attachment!.flags ?? 0) & ForkMessageAttachmentFlags.HAS_COVER).toBe(0);
		expect(attachment!.waveform ?? null).toBeNull();
		expect(await storedCover(channelId, attachment!.id)).toBeNull();
	});

	it('leaves out a cover the NSFW check flags, and keeps the waveform', async () => {
		mediaService.coverVerdict = 'explicit';
		recordExtras(extrasResponse);
		const {response, json, channelId} = await send('Spell.wav', AUDIO);

		expect(response.status).toBe(200);
		const [attachment] = json.attachments!;
		expect((attachment!.flags ?? 0) & ForkMessageAttachmentFlags.HAS_COVER).toBe(0);
		expect(attachment!.waveform).toBe(WAVEFORM);
		expect(await storedCover(channelId, attachment!.id)).toBeNull();
	});

	it('keeps a voice message its own waveform', async () => {
		recordExtras(extrasResponse);
		const own = Buffer.from([1, 2, 3]).toString('base64');
		const {response, json, channelId} = await send('voice.wav', AUDIO, {waveform: own, duration: 3});

		expect(response.status).toBe(200);
		expect(json.attachments![0]!.waveform).toBe(own);
		expect(await storedWaveform(channelId, json.attachments![0]!.id)).toBe(own);
	});

	it('deletes the cover and the stored waveform with the message', async () => {
		recordExtras(extrasResponse);
		const {json, channelId, account} = await send('Spell.wav', AUDIO);
		const attachmentId = json.attachments![0]!.id;
		expect(await storedCover(channelId, attachmentId)).not.toBeNull();
		expect(await storedWaveform(channelId, attachmentId)).not.toBeNull();

		await createBuilder(harness, account.token)
			.delete(`/channels/${channelId}/messages/${json.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		expect(await storedCover(channelId, attachmentId)).toBeNull();
		expect(await storedWaveform(channelId, attachmentId)).toBeNull();
	});

	it('copies the cover and the stored waveform when the message is forwarded', async () => {
		recordExtras(extrasResponse);
		const {json, channelId, account, guildId} = await send('Spell.wav', AUDIO);

		const forward = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${channelId}/messages`)
			.body({
				message_reference: {
					message_id: json.id,
					channel_id: channelId,
					guild_id: guildId,
					type: MessageReferenceTypes.FORWARD,
				},
			})
			.expect(HTTP_STATUS.OK)
			.execute();

		const copied = forward.message_snapshots?.[0]?.attachments?.[0];
		expect(copied).toBeDefined();
		expect(copied!.id).not.toBe(json.attachments![0]!.id);
		expect(copied!.flags! & ForkMessageAttachmentFlags.HAS_COVER).not.toBe(0);
		expect(await storedCover(channelId, copied!.id)).toEqual(COVER);
		expect(await storedWaveform(channelId, copied!.id)).toBe(WAVEFORM);
	});

	/** The extras of a WAV stored after its strip: the waveform, and no cover inside the file. */
	function extrasWithoutCover(): Response {
		return HttpResponse.json({waveform: WAVEFORM, cover: null});
	}

	async function saveToSavedMedia() {
		let calls = 0;
		const requests = recordExtras(() => (calls++ === 0 ? extrasResponse() : extrasWithoutCover()));
		const {json, channelId, account} = await send('Spell.wav', AUDIO);
		const meme = await createFavoriteMemeFromMessage(harness, account.token, channelId, json.id, {
			attachment_id: json.attachments![0]!.id,
			name: 'Spell',
		});
		const savedCoverKey = forkAttachmentCoverKey(BigInt(meme.user_id), BigInt(meme.attachment_id));
		const savedWaveformKey = forkAttachmentWaveformKey(BigInt(meme.user_id), BigInt(meme.attachment_id));
		return {requests, json, channelId, account, meme, savedCoverKey, savedWaveformKey};
	}

	it('gives audio sent from saved media its cover and waveform, the cover copied with the file', async () => {
		const {requests, json, channelId, account, meme, savedCoverKey, savedWaveformKey} = await saveToSavedMedia();
		expect(await storedObject(savedCoverKey)).toEqual(COVER);
		// A link to the saved file shows its waveform from this copy.
		expect((await storedObject(savedWaveformKey))?.toString('base64')).toBe(WAVEFORM);

		const sent = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${channelId}/messages`)
			.body({favorite_meme_id: meme.id})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(requests).toHaveLength(2);
		expect(requests[1]!.body).toMatchObject({type: 's3', bucket: Config.s3.buckets.cdn});
		const [attachment] = sent.attachments!;
		expect(attachment!.id).not.toBe(json.attachments![0]!.id);
		expect(attachment!.waveform).toBe(WAVEFORM);
		expect(attachment!.flags! & ForkMessageAttachmentFlags.HAS_COVER).not.toBe(0);
		expect(await storedCover(channelId, attachment!.id)).toEqual(COVER);
		expect(await storedWaveform(channelId, attachment!.id)).toBe(WAVEFORM);
	});

	it("deletes a saved audio file's cover and waveform with it", async () => {
		const {account, meme, savedCoverKey, savedWaveformKey} = await saveToSavedMedia();
		expect(await storedObject(savedCoverKey)).not.toBeNull();
		expect(await storedObject(savedWaveformKey)).not.toBeNull();

		await createBuilder(harness, account.token)
			.delete(`/users/@me/memes/${meme.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();

		expect(await storedObject(savedCoverKey)).toBeNull();
		expect(await storedObject(savedWaveformKey)).toBeNull();
	});
});

describe('forkAttachmentExtraKeys and forkMayHaveCover', () => {
	it('lists the covers of flagged attachments and the waveforms of those that have one', () => {
		expect(
			forkAttachmentExtraKeys(5n, [
				{id: 1n, flags: ForkMessageAttachmentFlags.HAS_COVER, waveform: null},
				{id: 2n, flags: 0, waveform: null},
				{id: 3n, flags: ForkMessageAttachmentFlags.HAS_COVER | 8, waveform: WAVEFORM},
				{id: 4n, flags: 0, waveform: WAVEFORM},
			]),
		).toEqual([
			'attachment-covers/5/1',
			'attachment-covers/5/3',
			'attachment-waveforms/5/3',
			'attachment-waveforms/5/4',
		]);
	});

	it('takes an audio file name as one that may have a cover', () => {
		expect(forkMayHaveCover('Spell.wav')).toBe(true);
		expect(forkMayHaveCover('song.mp3')).toBe(true);
		expect(forkMayHaveCover('picture.png')).toBe(false);
	});
});
