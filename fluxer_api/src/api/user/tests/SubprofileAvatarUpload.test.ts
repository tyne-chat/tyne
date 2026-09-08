// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createTestAccount} from '../../auth/tests/AuthTestUtils';
import {getPngDataUrl} from '../../emoji/tests/EmojiTestUtils';
import {ensureSessionStarted} from '../../message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

interface SubprofileAvatarUploadResponse {
	avatar_url: string;
}

describe('Subprofile Avatar Upload', () => {
	let harness: ApiTestHarness;
	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});

	it('uploads subprofile avatar and returns cdn url', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const result = await createBuilder<SubprofileAvatarUploadResponse>(harness, account.token)
			.post('/users/@me/subprofiles/avatar')
			.body({avatar: getPngDataUrl()})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(result.avatar_url).toBeTruthy();
		expect(result.avatar_url).toContain('avatars');
	});

	it('rejects invalid avatar payload', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		await createBuilder(harness, account.token)
			.post('/users/@me/subprofiles/avatar')
			.body({avatar: 'invalid-image-data'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
	});

	it('imports subprofile avatar from remote url', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const fakeBuffer = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
			'base64',
		);
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(fakeBuffer, {
				status: 200,
				headers: {'content-type': 'image/png'},
			}),
		);

		const result = await createBuilder<SubprofileAvatarUploadResponse>(harness, account.token)
			.post('/users/@me/subprofiles/import-avatar')
			.body({url: 'https://example.com/avatar.png'})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(result.avatar_url).toBeTruthy();
		expect(result.avatar_url).toContain('avatars');
		fetchSpy.mockRestore();
	});

	it('rejects avatar import on 404 remote response', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('Not found', {
				status: 404,
				statusText: 'Not Found',
			}),
		);

		await createBuilder(harness, account.token)
			.post('/users/@me/subprofiles/import-avatar')
			.body({url: 'https://example.com/notfound.png'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();

		fetchSpy.mockRestore();
	});
});
