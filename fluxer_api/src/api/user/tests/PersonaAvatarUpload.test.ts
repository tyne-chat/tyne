// SPDX-License-Identifier: AGPL-3.0-or-later

import {AVATAR_MAX_SIZE} from '@fluxer/constants/src/LimitConstants';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi} from 'vitest';
import {createTestAccount} from '../../auth/tests/AuthTestUtils';
import {Config} from '../../Config';
import {getPngDataUrl} from '../../emoji/tests/EmojiTestUtils';
import type {
	MediaProxyMetadataExternalRequest,
	MediaProxyMetadataRequest,
	MediaProxyMetadataResponse,
} from '../../infrastructure/IMediaService';
import {ensureSessionStarted} from '../../message/tests/MessageTestUtils';
import {setInjectedMediaService} from '../../middleware/ServiceRegistry';
import {PERSONA_AVATAR_IMPORT_QUOTA} from '../../persona/PersonaAvatarImporter';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import type {MockKVProvider} from '../../test/mocks/MockKVProvider';
import {HTTP_STATUS} from '../../test/TestConstants';
import {TestMediaService} from '../../test/TestMediaService';
import {createBuilder} from '../../test/TestRequestBuilder';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMPORT_FAILED_MESSAGE = 'Could not import an avatar from this URL';
const INVALID_URL_MESSAGE = 'Invalid avatar URL';
const QUOTA_KEY_FRAGMENT = 'persona:avatar_import:';

// Stands in for the media proxy, which is the only thing that fetches a remote avatar. The real
// client answers null for every refusal or failure (blocked address, redirect to a private host,
// oversized body, upstream error), so "unreachable" here covers all of them.
class RemoteAvatarMediaService extends TestMediaService {
	readonly externalRequests: Array<MediaProxyMetadataExternalRequest> = [];
	gate: Promise<void> | null = null;

	override async getMetadata(request: MediaProxyMetadataRequest): Promise<MediaProxyMetadataResponse | null> {
		if (request.type !== 'external') return super.getMetadata(request);
		this.externalRequests.push(request);
		if (this.gate) await this.gate;
		if (request.url.includes('unreachable')) return null;
		const metadata = await super.getMetadata(request);
		if (!metadata) return null;
		const base64 = request.url.includes('corrupted') ? Buffer.from('not an image').toString('base64') : PNG_BASE64;
		return {...metadata, base64};
	}
}

function ownMediaUrl(path: string): string {
	return `${Config.endpoints.media.replace(/\/$/, '')}${path}`;
}

async function readEvents(res: Response): Promise<Array<any>> {
	const text = await res.text();
	return text
		.trim()
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

interface PersonaAvatarUploadResponse {
	avatar_hash: string;
}

describe('Persona Avatar Upload', () => {
	let harness: ApiTestHarness;
	let media: RemoteAvatarMediaService;
	let fetchSpy: MockInstance<typeof fetch>;
	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
		media = new RemoteAvatarMediaService(harness.storageService);
		setInjectedMediaService(media);
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});
	afterEach(() => {
		// The API process must never fetch a user-supplied URL itself (audit M1-1). Registration's
		// breached-password lookup is the only outbound request these tests are expected to make.
		const unexpected = fetchSpy.mock.calls
			.map(([input]) => String(input instanceof Request ? input.url : input))
			.filter((url) => !url.startsWith('https://api.pwnedpasswords.com/'));
		expect(unexpected).toEqual([]);
		fetchSpy.mockRestore();
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

	const importAvatar = (token: string, url: string) =>
		harness.requestJson({
			path: '/users/@me/personas/import-avatar',
			method: 'POST',
			body: {url},
			headers: {authorization: token},
		});
	const importBatch = (token: string, urls: Array<string>) =>
		harness.requestJson({
			path: '/users/@me/personas/import-batch-avatars',
			method: 'POST',
			body: {urls},
			headers: {authorization: token},
		});
	const quotaCharges = () =>
		(harness.kvProvider as MockKVProvider).checkLeakyBucketLimitSpy.mock.calls.filter(
			([key, , , cost]) => String(key).includes(QUOTA_KEY_FRAGMENT) && cost === 1,
		).length;

	it('imports a persona avatar through the media proxy with the avatar size cap', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		const res = await importAvatar(account.token, 'https://example.com/avatar.png?size=256#ignored');

		expect(res.status).toBe(HTTP_STATUS.OK);
		const body = (await res.json()) as PersonaAvatarUploadResponse;
		expect(body.avatar_hash.length).toBeGreaterThanOrEqual(8);
		expect(media.externalRequests).toEqual([
			{
				type: 'external',
				url: 'https://example.com/avatar.png?size=256',
				with_base64: true,
				max_bytes: AVATAR_MAX_SIZE,
				nsfw: 'allow',
			},
		]);
		expect(quotaCharges()).toBe(1);
	});

	it('answers every failed fetch with the same message', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);

		for (const url of [
			'https://example.com/unreachable.png',
			'http://postgres:5432/unreachable',
			'http://169.254.169.254/unreachable',
		]) {
			const res = await importAvatar(account.token, url);
			expect(res.status, url).toBe(HTTP_STATUS.BAD_REQUEST);
			expect(await res.json(), url).toEqual({message: IMPORT_FAILED_MESSAGE});
		}
		const corrupted = await importAvatar(account.token, 'https://example.com/corrupted.png');
		expect(corrupted.status).toBe(HTTP_STATUS.BAD_REQUEST);
		expect(await corrupted.json()).toEqual({message: IMPORT_FAILED_MESSAGE});
	});

	it('never hands the media proxy a URL on its own host, and does not charge for it', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const own = new URL(Config.endpoints.media);

		for (const url of [
			ownMediaUrl('/attachments/1/2/secret.png'),
			ownMediaUrl('/%61ttachments/1/2/secret.png'),
			`${own.protocol}//${own.hostname.toUpperCase()}:8443/attachments/1/2/secret.png`,
			`${own.protocol}//user:pass@${own.host}/attachments/1/2/secret.png`,
			'https://user:pass@example.com/avatar.png',
		]) {
			const res = await importAvatar(account.token, url);
			expect(res.status, url).toBe(HTTP_STATUS.BAD_REQUEST);
			expect(await res.json(), url).toEqual({message: INVALID_URL_MESSAGE});
		}
		expect(media.externalRequests).toEqual([]);
		expect(quotaCharges()).toBe(0);
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

	it('streams batch avatar import progress via NDJSON, keyed by the submitted URL', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const ownUrl = ownMediaUrl('/attachments/1/2/secret.png');
		const urls = [
			'https://example.com/valid1.png#frag',
			'https://example.com/unreachable.png',
			'https://example.com/corrupted.png',
			ownUrl,
		];

		const res = await importBatch(account.token, urls);

		expect(res.status).toBe(HTTP_STATUS.OK);
		expect(res.headers.get('content-type')).toContain('application/x-ndjson');
		const events = await readEvents(res);
		expect(events[0]).toEqual({type: 'start', total: 4});
		const progress = events.filter((e) => e.type === 'progress');
		expect(progress.map((p) => p.url).sort()).toEqual([...urls].sort());
		expect(progress.map((p) => p.completed).sort()).toEqual([1, 2, 3, 4]);
		const complete = events.at(-1);
		expect(complete.type).toBe('complete');
		expect(complete.total).toBe(4);
		expect(complete.results['https://example.com/valid1.png#frag'].avatar_hash).toBeTruthy();
		expect(complete.results['https://example.com/unreachable.png']).toEqual({error: IMPORT_FAILED_MESSAGE});
		expect(complete.results['https://example.com/corrupted.png']).toEqual({error: IMPORT_FAILED_MESSAGE});
		expect(complete.results[ownUrl]).toEqual({error: INVALID_URL_MESSAGE});
		expect(media.externalRequests.every((request) => request.max_bytes === AVATAR_MAX_SIZE)).toBe(true);
		// One unit per URL that reached the proxy; the refused own-host URL is free.
		expect(quotaCharges()).toBe(3);
	});

	it('refuses a batch the remaining quota cannot cover before fetching anything', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const kv = harness.kvProvider as MockKVProvider;
		const realCheck = kv.checkLeakyBucketLimit.bind(kv);
		const checkSpy = vi.spyOn(kv, 'checkLeakyBucketLimit').mockImplementation(async (key, limit, windowMs, cost) => {
			if (!key.includes(QUOTA_KEY_FRAGMENT)) return realCheck(key, limit, windowMs, cost);
			expect(limit).toBe(PERSONA_AVATAR_IMPORT_QUOTA.maxAttempts);
			expect(windowMs).toBe(PERSONA_AVATAR_IMPORT_QUOTA.windowMs);
			const resetAfterMs = 60_000;
			return {
				allowed: cost === 0,
				limit,
				remaining: cost === 0 ? 1 : 0,
				resetAfterMs,
				resetAtMs: Date.now() + resetAfterMs,
				retryAfterMs: cost === 0 ? 0 : resetAfterMs,
			};
		});

		const batch = await importBatch(account.token, ['https://example.com/a.png', 'https://example.com/b.png']);
		expect(batch.status).toBe(429);
		expect(Number(batch.headers.get('retry-after'))).toBeGreaterThan(0);

		const single = await importAvatar(account.token, 'https://example.com/a.png');
		expect(single.status).toBe(429);

		expect(media.externalRequests).toEqual([]);
		checkSpy.mockRestore();
	});

	it('reports URLs the quota ran out for mid-batch without failing the stream', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const kv = harness.kvProvider as MockKVProvider;
		const realCheck = kv.checkLeakyBucketLimit.bind(kv);
		let charged = 0;
		const checkSpy = vi.spyOn(kv, 'checkLeakyBucketLimit').mockImplementation(async (key, limit, windowMs, cost) => {
			if (!key.includes(QUOTA_KEY_FRAGMENT) || cost === 0) return realCheck(key, limit, windowMs, cost);
			charged++;
			if (charged <= 1) return realCheck(key, limit, windowMs, cost);
			return {
				allowed: false,
				limit,
				remaining: 0,
				resetAfterMs: 1000,
				resetAtMs: Date.now() + 1000,
				retryAfterMs: 1000,
			};
		});

		const res = await importBatch(account.token, ['https://example.com/a.png', 'https://example.com/b.png']);

		expect(res.status).toBe(HTTP_STATUS.OK);
		const complete = (await readEvents(res)).at(-1);
		const results = Object.values(complete.results) as Array<{avatar_hash?: string; error?: string}>;
		expect(results.filter((r) => r.avatar_hash)).toHaveLength(1);
		expect(results.filter((r) => r.error === 'Avatar import limit reached, try again later')).toHaveLength(1);
		expect(media.externalRequests).toHaveLength(1);
		checkSpy.mockRestore();
	});

	it('runs one batch per user at a time and frees the slot when it ends', async () => {
		const account = await createTestAccount(harness);
		await ensureSessionStarted(harness, account.token);
		const other = await createTestAccount(harness);
		await ensureSessionStarted(harness, other.token);
		let openGate: () => void = () => {};
		media.gate = new Promise<void>((resolve) => {
			openGate = resolve;
		});

		const first = await importBatch(account.token, ['https://example.com/slow.png']);
		expect(first.status).toBe(HTTP_STATUS.OK);
		await vi.waitFor(() => expect(media.externalRequests).toHaveLength(1));

		const second = await importBatch(account.token, ['https://example.com/second.png']);
		expect(second.status).toBe(429);
		const otherUser = importBatch(other.token, ['https://example.com/other.png']);
		await vi.waitFor(() => expect(media.externalRequests).toHaveLength(2));

		openGate();
		media.gate = null;
		expect((await readEvents(first)).at(-1).type).toBe('complete');
		expect((await readEvents(await otherUser)).at(-1).type).toBe('complete');

		const third = await importBatch(account.token, ['https://example.com/third.png']);
		expect(third.status).toBe(HTTP_STATUS.OK);
		expect((await readEvents(third)).at(-1).results['https://example.com/third.png'].avatar_hash).toBeTruthy();
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
		const url = 'https://example.com/duplicate.png';

		const res = await importBatch(account.token, [url, url, url]);

		expect(res.status).toBe(HTTP_STATUS.OK);
		const events = await readEvents(res);
		expect(events.find((e) => e.type === 'start')?.total).toBe(1);
		expect(events.filter((e) => e.type === 'progress')).toHaveLength(1);
		expect(Object.keys(events.at(-1).results)).toEqual([url]);
		expect(media.externalRequests).toHaveLength(1);
		expect(quotaCharges()).toBe(1);
	});
});
