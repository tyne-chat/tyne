// SPDX-License-Identifier: AGPL-3.0-or-later

import {AttachmentDecayRepository} from '@app/api/attachment/AttachmentDecayRepository';
import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createAttachmentID} from '@app/api/BrandedTypes';
import {
	createMultipartFormData,
	loadFixture,
	sendMessageWithAttachments,
	setupTestGuildAndChannel,
} from '@app/api/channel/tests/AttachmentTestUtils';
import {
	getAssetDeletionQueue,
	getChannelRepository,
	getInstanceConfigRepository,
} from '@app/api/middleware/ServiceSingletons';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {processExpiredAttachments} from '@app/api/worker/tasks/ExpireAttachments';
import {clearWorkerDependencies, setWorkerDependenciesForTest} from '@app/api/worker/WorkerContext';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {snowflakeToDate} from '@fluxer/snowflake/src/Snowflake';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

describe('Fork: an edit that adds a file', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;
	let channelId: string;
	const image = loadFixture('yeah.png');

	async function edit(messageId: string, payload: Record<string, unknown>, filenames: Array<string>) {
		const {body, contentType} = createMultipartFormData(
			payload,
			filenames.map((filename, index) => ({index, filename, data: image, contentType: 'image/png'})),
		);
		const response = await harness.app.request(`/channels/${channelId}/messages/${messageId}`, {
			method: 'PATCH',
			headers: {'Content-Type': contentType, Authorization: account.token, 'x-forwarded-for': '127.0.0.1'},
			body,
		});
		expect(response.status).toBe(HTTP_STATUS.OK);
		return (await response.json()) as MessageResponse;
	}

	async function sendText(content: string): Promise<MessageResponse> {
		const {json} = await sendMessageWithAttachments(harness, account.token, channelId, {content}, []);
		return json;
	}

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		harness.storageService.reset();
		account = await createTestAccount(harness);
		const {channel} = await setupTestGuildAndChannel(harness, account);
		channelId = channel.id;
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	it('marks the message edited when the text stays the same', async () => {
		const message = await sendText('look at this');
		expect(message.edited_timestamp ?? null).toBeNull();

		const edited = await edit(message.id, {attachments: [{id: 0, filename: 'added.png'}]}, ['added.png']);

		expect(edited.content).toBe('look at this');
		expect(edited.attachments?.map((attachment) => attachment.filename)).toEqual(['added.png']);
		expect(edited.edited_timestamp).toBeTruthy();
	});

	it('dates a file by the edit that added it, so it survives on a message older than its lifetime', async () => {
		const message = await sendText('from long ago');
		const year = 365 * 24 * 60 * 60 * 1000;
		vi.useFakeTimers({toFake: ['Date'], now: Date.now() + 4 * year});
		try {
			expect(snowflakeToDate(BigInt(message.id)).getTime()).toBeLessThan(Date.now() - 3 * year);

			const edited = await edit(message.id, {attachments: [{id: 0, filename: 'late.png'}]}, ['late.png']);
			const attachmentId = createAttachmentID(BigInt(edited.attachments?.[0]?.id ?? 0));

			// Reading the channel is what gives a file with no record the message's age.
			await createBuilder<Array<MessageResponse>>(harness, account.token)
				.get(`/channels/${channelId}/messages?limit=1`)
				.execute();
			setWorkerDependenciesForTest({
				assetDeletionQueue: getAssetDeletionQueue(),
				channelRepository: getChannelRepository(),
				instanceConfigRepository: getInstanceConfigRepository(),
				kvClient: harness.kvProvider,
				storageService: harness.storageService,
			});
			await processExpiredAttachments();

			const record = await new AttachmentDecayRepository().fetchById(attachmentId);
			expect(record?.expires_at.getTime()).toBeGreaterThan(Date.now() + year);
		} finally {
			clearWorkerDependencies();
			vi.useRealTimers();
		}
	});

	it('keeps the attachments the edit names, and drops the ones it leaves out', async () => {
		const message = await sendText('files');
		const first = await edit(message.id, {attachments: [{id: 0, filename: 'first.png'}]}, ['first.png']);
		const firstId = first.attachments?.[0]?.id;

		const both = await edit(message.id, {attachments: [{id: firstId}, {id: 0, filename: 'second.png'}]}, [
			'second.png',
		]);
		expect(both.attachments?.map((attachment) => attachment.filename)).toEqual(['first.png', 'second.png']);

		const replaced = await edit(message.id, {attachments: [{id: 0, filename: 'third.png'}]}, ['third.png']);
		expect(replaced.attachments?.map((attachment) => attachment.filename)).toEqual(['third.png']);
	});
});
