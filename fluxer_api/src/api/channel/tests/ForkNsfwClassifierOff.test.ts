// SPDX-License-Identifier: AGPL-3.0-or-later
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {forkNsfwClassifierOff} from '@app/api/channel/services/message/ForkNsfwClassifier';
import {
	createChannel,
	createGuild,
	loadFixture,
	sendMessageWithAttachments,
} from '@app/api/channel/tests/AttachmentTestUtils';
import type {MediaProxyMetadataRequest, MediaProxyMetadataResponse} from '@app/api/infrastructure/IMediaService';
import {setInjectedMediaService} from '@app/api/middleware/ServiceRegistry';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {TestMediaService} from '@app/api/test/TestMediaService';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {MessageReferenceTypes} from '@fluxer/constants/src/ChannelConstants';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const VARIABLE = 'FLUXER_NSFW_SERVICE_ENDPOINT';
const IMAGE = loadFixture('yeah.png');

/** Sets the variable for one test; `undefined` removes it. Restored by `restoreVariable`. */
const original = process.env[VARIABLE];
function setVariable(value: string | undefined): void {
	if (value === undefined) {
		delete process.env[VARIABLE];
	} else {
		process.env[VARIABLE] = value;
	}
}
function restoreVariable(): void {
	setVariable(original);
}

/** The test media service, recording each probe of a stored file and answering it with the test's verdict. */
class RecordingMediaService extends TestMediaService {
	storedProbes: Array<string> = [];
	verdict: 'clean' | 'explicit' = 'clean';

	override async getMetadata(request: MediaProxyMetadataRequest): Promise<MediaProxyMetadataResponse | null> {
		const metadata = await super.getMetadata(request);
		if (request.type !== 's3' || !metadata) return metadata;
		this.storedProbes.push(request.key);
		return {...metadata, nsfw: this.verdict === 'explicit'};
	}
}

describe('forkNsfwClassifierOff reads the media proxy setting (tyne-chat/tyne#888)', () => {
	afterEach(restoreVariable);

	it('is off only when the variable is given and empty, as the media proxy reads it', () => {
		setVariable(undefined);
		expect(forkNsfwClassifierOff()).toBe(false);
		setVariable('');
		expect(forkNsfwClassifierOff()).toBe(true);
		setVariable('/');
		expect(forkNsfwClassifierOff()).toBe(true);
		setVariable('http://classifier:8080/');
		expect(forkNsfwClassifierOff()).toBe(false);
	});

	it('treats spaces as an endpoint, as the media proxy does', () => {
		setVariable(' ');
		expect(forkNsfwClassifierOff()).toBe(false);
	});
});

describe('Forwards skip the explicit-content probe without a classifier (tyne-chat/tyne#888)', () => {
	let harness: ApiTestHarness;
	let mediaService: RecordingMediaService;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});
	beforeEach(async () => {
		await harness.reset();
		mediaService = new RecordingMediaService(harness.storageService);
		setInjectedMediaService(mediaService);
	});
	afterEach(() => {
		restoreVariable();
		setInjectedMediaService(new TestMediaService(harness.storageService));
	});

	/**
	 * Sends a message with two images to a channel that does not allow explicit media, then forwards it
	 * there; returns the forward's response and the probes the forward made.
	 */
	async function forwardImages(status: number = HTTP_STATUS.OK, errorCode?: string) {
		const account = await createTestAccount(harness);
		const guild = await createGuild(harness, account.token, 'Forward Guild');
		const channel = await createChannel(harness, account.token, guild.id, 'photos');
		const filenames = ['one.png', 'two.png'];
		const {json} = await sendMessageWithAttachments(
			harness,
			account.token,
			channel.id,
			{content: 'photos', attachments: filenames.map((filename, id) => ({id, filename}))},
			filenames.map((filename, index) => ({index, filename, data: IMAGE})),
		);
		mediaService.storedProbes = [];
		const forward = await createBuilder<MessageResponse>(harness, account.token)
			.post(`/channels/${channel.id}/messages`)
			.body({
				message_reference: {
					message_id: json.id,
					channel_id: channel.id,
					guild_id: guild.id,
					type: MessageReferenceTypes.FORWARD,
				},
			})
			.expect(status, errorCode)
			.execute();
		return {original: json, forward, probes: [...mediaService.storedProbes]};
	}

	it('probes each forwarded image when the API is not given the setting, as upstream does', async () => {
		setVariable(undefined);
		const {forward, probes} = await forwardImages();

		expect(probes).toHaveLength(2);
		expect(forward.message_snapshots?.[0]?.attachments).toHaveLength(2);
	});

	// The media service would call both images explicit, which refuses the forward when it is asked
	// (next test): the forward going through shows it was not asked.
	it('sends no probe when the setting is empty, and forwards the images unchanged', async () => {
		setVariable('');
		mediaService.verdict = 'explicit';
		const {original, forward, probes} = await forwardImages();

		expect(probes).toEqual([]);
		const copies = forward.message_snapshots?.[0]?.attachments ?? [];
		const pick = (attachment: {
			filename: string;
			width?: number | null;
			height?: number | null;
			nsfw?: boolean | null;
		}) => ({
			filename: attachment.filename,
			width: attachment.width,
			height: attachment.height,
			nsfw: attachment.nsfw ?? false,
		});
		expect(copies.map(pick)).toEqual((original.attachments ?? []).map(pick));
		expect(copies.map((copy) => copy.nsfw ?? false)).toEqual([false, false]);
	});

	it('still probes when an endpoint is set, and refuses a forward the classifier calls explicit', async () => {
		setVariable('http://classifier.invalid:8080');
		mediaService.verdict = 'explicit';
		const {probes} = await forwardImages(HTTP_STATUS.FORBIDDEN, APIErrorCodes.NSFW_CONTENT_AGE_RESTRICTED);

		expect(probes).toHaveLength(2);
	});
});
