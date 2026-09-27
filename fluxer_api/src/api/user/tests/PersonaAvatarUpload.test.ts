// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createTestAccount} from '../../auth/tests/AuthTestUtils';
import {getPngDataUrl} from '../../emoji/tests/EmojiTestUtils';
import {ensureSessionStarted} from '../../message/tests/MessageTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

interface PersonaAvatarUploadResponse {
	avatar_hash: string;
}

describe('Persona Avatar Upload', () => {
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

	it('uploads persona avatar and returns cdn url', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const result = await createBuilder<PersonaAvatarUploadResponse>(harness, account.token)
			.post('/users/@me/personas/avatar')
			.body({avatar: getPngDataUrl()})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(result.avatar_hash).toBeTruthy();
		expect(result.avatar_hash.length).toBeGreaterThanOrEqual(8);
	});

	it('rejects invalid avatar payload', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		await createBuilder(harness, account.token)
			.post('/users/@me/personas/avatar')
			.body({avatar: 'invalid-image-data'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
	});

	it('imports persona avatar from remote url', async () => {
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

		const result = await createBuilder<PersonaAvatarUploadResponse>(harness, account.token)
			.post('/users/@me/personas/import-avatar')
			.body({url: 'https://example.com/avatar.png'})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(result.avatar_hash).toBeTruthy();
		expect(result.avatar_hash.length).toBeGreaterThanOrEqual(8);
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
			.post('/users/@me/personas/import-avatar')
			.body({url: 'https://example.com/notfound.png'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();

		fetchSpy.mockRestore();
	});

	it('uploads persona banner and returns banner_hash', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const result = await createBuilder<{banner_hash: string}>(harness, account.token)
			.post('/users/@me/personas/banner')
			.body({banner: getPngDataUrl()})
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(result.banner_hash).toBeTruthy();
		expect(result.banner_hash.length).toBeGreaterThanOrEqual(8);
	});

	it('rejects invalid persona banner payload', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		await createBuilder(harness, account.token)
			.post('/users/@me/personas/banner')
			.body({banner: 'invalid-banner-data'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
	});

	it('streams batch avatar import progress via NDJSON', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const fakeBuffer = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
			'base64',
		);
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = typeof input === 'string' ? input : (input as Request).url;
			if (url.includes('notfound.png')) {
				return new Response('Not found', {status: 404, statusText: 'Not Found'});
			}
			if (url.includes('corrupted.png')) {
				return new Response(Buffer.from('corrupted image bytes not valid png'), {
					status: 200,
					headers: {'content-type': 'image/png'},
				});
			}
			return new Response(fakeBuffer, {
				status: 200,
				headers: {'content-type': 'image/png'},
			});
		});

		const res = await harness.requestJson({
			path: '/users/@me/personas/import-batch-avatars',
			method: 'POST',
			body: {
				urls: [
					'https://example.com/valid1.png',
					'https://example.com/notfound.png',
					'http://127.0.0.1/private.png',
					'https://example.com/corrupted.png',
				],
			},
			headers: {
				authorization: account.token,
			},
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/x-ndjson');

		const text = await res.text();
		const lines = text
			.trim()
			.split('\n')
			.filter((l) => l.trim().length > 0);
		const events = lines.map((l) => JSON.parse(l));

		// First event is 'start'
		expect(events[0].type).toBe('start');
		expect(events[0].total).toBe(4);

		// Progress events
		const progressEvents = events.filter((e) => e.type === 'progress');
		expect(progressEvents.length).toBe(4);

		const valid1Prog = progressEvents.find((p) => p.url === 'https://example.com/valid1.png');
		expect(valid1Prog?.avatar_hash).toBeTruthy();
		expect(valid1Prog?.error).toBeUndefined();

		const notFoundProg = progressEvents.find((p) => p.url === 'https://example.com/notfound.png');
		expect(notFoundProg?.error).toBeDefined();

		const ssrfProg = progressEvents.find((p) => p.url === 'http://127.0.0.1/private.png');
		expect(ssrfProg?.error).toBeDefined();

		const corruptProg = progressEvents.find((p) => p.url === 'https://example.com/corrupted.png');
		expect(corruptProg?.error).toBeDefined();

		// Final event is 'complete'
		const completeEvent = events.find((e) => e.type === 'complete');
		expect(completeEvent).toBeDefined();
		expect(completeEvent.total).toBe(4);
		expect(completeEvent.results['https://example.com/valid1.png']?.avatar_hash).toBeTruthy();
		expect(completeEvent.results['https://example.com/notfound.png']?.error).toBeDefined();
		expect(completeEvent.results['http://127.0.0.1/private.png']?.error).toBeDefined();
		expect(completeEvent.results['https://example.com/corrupted.png']?.error).toBeDefined();

		fetchSpy.mockRestore();
	});

	it('rejects batch avatar import exceeding 10MB limit or network failure', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = typeof input === 'string' ? input : (input as Request).url;
			if (url.includes('huge.png')) {
				return new Response(new Uint8Array(11 * 1024 * 1024), {
					status: 200,
					headers: {'content-type': 'image/png'},
				});
			}
			throw new Error('Connection refused');
		});

		const res = await harness.requestJson({
			path: '/users/@me/personas/import-batch-avatars',
			method: 'POST',
			body: {
				urls: ['https://example.com/huge.png', 'https://example.com/networkerror.png'],
			},
			headers: {
				authorization: account.token,
			},
		});

		expect(res.status).toBe(200);
		const text = await res.text();
		const events = text
			.trim()
			.split('\n')
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l));

		const completeEvent = events.find((e) => e.type === 'complete');
		expect(completeEvent).toBeDefined();
		expect(completeEvent.results['https://example.com/huge.png']?.error).toContain('10MB limit');
		expect(completeEvent.results['https://example.com/networkerror.png']?.error).toContain('Failed to download');

		fetchSpy.mockRestore();
	});

	it('rejects invalid batch avatar import request payloads', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		// 1. Empty urls array
		const emptyRes = await harness.requestJson({
			path: '/users/@me/personas/import-batch-avatars',
			method: 'POST',
			body: {urls: []},
			headers: {authorization: account.token},
		});
		expect(emptyRes.status).toBe(HTTP_STATUS.BAD_REQUEST);

		// 2. Invalid URL string
		const invalidUrlRes = await harness.requestJson({
			path: '/users/@me/personas/import-batch-avatars',
			method: 'POST',
			body: {urls: ['not-a-url']},
			headers: {authorization: account.token},
		});
		expect(invalidUrlRes.status).toBe(HTTP_STATUS.BAD_REQUEST);

		// 3. Exceeds 500 URLs
		const tooManyUrls = Array.from({length: 501}, (_, i) => `https://example.com/avatar${i}.png`);
		const oversizedRes = await harness.requestJson({
			path: '/users/@me/personas/import-batch-avatars',
			method: 'POST',
			body: {urls: tooManyUrls},
			headers: {authorization: account.token},
		});
		expect(oversizedRes.status).toBe(HTTP_STATUS.BAD_REQUEST);
	});

	it('deduplicates duplicate URLs during batch avatar import', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const fakeBuffer = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
			'base64',
		);
		let fetchCallCount = 0;
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			fetchCallCount++;
			return new Response(fakeBuffer, {
				status: 200,
				headers: {'content-type': 'image/png'},
			});
		});

		const res = await harness.requestJson({
			path: '/users/@me/personas/import-batch-avatars',
			method: 'POST',
			body: {
				urls: [
					'https://example.com/duplicate.png',
					'https://example.com/duplicate.png',
					'https://example.com/duplicate.png',
				],
			},
			headers: {authorization: account.token},
		});

		expect(res.status).toBe(HTTP_STATUS.OK);
		const text = await res.text();
		const events = text
			.trim()
			.split('\n')
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l));

		const startEvent = events.find((e) => e.type === 'start');
		expect(startEvent?.total).toBe(1);

		const progressEvents = events.filter((e) => e.type === 'progress');
		expect(progressEvents.length).toBe(1);

		const completeEvent = events.find((e) => e.type === 'complete');
		expect(completeEvent?.total).toBe(1);
		expect(Object.keys(completeEvent?.results ?? {})).toHaveLength(1);
		expect(fetchCallCount).toBe(1);

		fetchSpy.mockRestore();
	});
});
