// SPDX-License-Identifier: AGPL-3.0-or-later

import type {UserID} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import type {EntityAssetService} from '@app/api/infrastructure/EntityAssetService';
import type {IMediaService} from '@app/api/infrastructure/IMediaService';
import {Logger} from '@app/api/Logger';
import {deriveDominantAvatarColor} from '@app/api/utils/AvatarColorUtils';
import {AVATAR_MAX_SIZE} from '@fluxer/constants/src/LimitConstants';
import {RateLimitError} from '@fluxer/errors/src/domains/core/RateLimitError';
import type {ICacheService} from '@pkgs/cache/src/ICacheService';
import type {IRateLimitService, RateLimitResult} from '@pkgs/rate_limit/src/IRateLimitService';
import {ms} from 'itty-time';

// One unit is one remote fetch, whichever route asked for it. The bucket holds as many fetches as
// the batch route used to allow per window (5 calls of 500 URLs), so a large PluralKit import
// still fits, while many small batches no longer cost more than the URLs they contain.
export const PERSONA_AVATAR_IMPORT_QUOTA = {
	maxAttempts: 2500,
	windowMs: ms('10 minutes'),
} as const;

const BATCH_CONCURRENCY = 4;
const BATCH_LOCK_TTL_SECONDS = 120;
const BATCH_LOCK_RETRY_AFTER_SECONDS = 5;

// The messages are fixed on purpose. Anything that described why a fetch failed (refused, reset,
// HTTP status) would let a caller map hosts this server can reach.
const INVALID_URL_MESSAGE = 'Invalid avatar URL';
const IMPORT_FAILED_MESSAGE = 'Could not import an avatar from this URL';
const QUOTA_EXHAUSTED_MESSAGE = 'Avatar import limit reached, try again later';

interface PersonaAvatarImportDeps {
	mediaService: IMediaService;
	entityAssetService: EntityAssetService;
	rateLimitService: IRateLimitService;
	cacheService: ICacheService;
}

export interface PersonaAvatarImportResult {
	avatar_hash?: string;
	avatar_color?: number | null;
	error?: string;
}

type PersonaAvatarImportOutcome =
	| {status: 'imported'; avatar_hash: string; avatar_color: number | null}
	| {status: 'invalid_url'}
	| {status: 'rate_limited'; rateLimit: RateLimitResult}
	| {status: 'failed'};

function quotaIdentifier(userId: UserID): string {
	return `persona:avatar_import:${userId}`;
}

function batchLockKey(userId: UserID): string {
	return `persona:avatar_import:batch:${userId}`;
}

function mediaEndpointHostname(): string | null {
	try {
		return new URL(Config.endpoints.media).hostname.toLowerCase();
	} catch {
		return null;
	}
}

// Returns the URL to hand to the media proxy, or null when it must not be fetched at all. The
// proxy owns the network policy (public addresses only, per-hop redirect checks, pinned DNS); the
// one thing it does not refuse is its own public host, which it reads straight from storage
// without a signature check. It recognises that host by exact name, and so does this.
export function normalizeAvatarImportUrl(rawUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username || url.password) return null;
	if (url.hostname.toLowerCase() === mediaEndpointHostname()) return null;
	url.hash = '';
	return url.href;
}

function rateLimitError(result: RateLimitResult): RateLimitError {
	return new RateLimitError({
		retryAfter: result.retryAfter,
		retryAfterDecimal: result.retryAfterDecimal,
		limit: result.limit,
		resetTime: result.resetTime,
		resetAfterDecimal: result.resetAfterDecimal,
	});
}

async function importOne(
	deps: PersonaAvatarImportDeps,
	userId: UserID,
	rawUrl: string,
): Promise<PersonaAvatarImportOutcome> {
	const url = normalizeAvatarImportUrl(rawUrl);
	if (url === null) return {status: 'invalid_url'};
	try {
		const rateLimit = await deps.rateLimitService.checkLimit({
			identifier: quotaIdentifier(userId),
			...PERSONA_AVATAR_IMPORT_QUOTA,
		});
		if (!rateLimit.allowed) return {status: 'rate_limited', rateLimit};
		const metadata = await deps.mediaService.getMetadata({
			type: 'external',
			url,
			with_base64: true,
			max_bytes: AVATAR_MAX_SIZE,
			nsfw: 'allow',
		});
		if (!metadata?.base64) return {status: 'failed'};
		const prepared = await deps.entityAssetService.prepareAssetUpload({
			assetType: 'avatar',
			entityType: 'user',
			entityId: userId,
			previousHash: null,
			base64Image: metadata.base64,
			errorPath: 'avatar',
		});
		await deps.entityAssetService.commitAssetChange(prepared);
		if (!prepared.newHash) return {status: 'failed'};
		const avatarColor = prepared.imageBuffer ? await deriveDominantAvatarColor(prepared.imageBuffer) : null;
		return {status: 'imported', avatar_hash: prepared.newHash, avatar_color: avatarColor};
	} catch (error) {
		Logger.warn({error, userId: userId.toString()}, 'Persona avatar import failed');
		return {status: 'failed'};
	}
}

function toResult(outcome: PersonaAvatarImportOutcome): PersonaAvatarImportResult {
	switch (outcome.status) {
		case 'imported':
			return {avatar_hash: outcome.avatar_hash, avatar_color: outcome.avatar_color};
		case 'invalid_url':
			return {error: INVALID_URL_MESSAGE};
		case 'rate_limited':
			return {error: QUOTA_EXHAUSTED_MESSAGE};
		case 'failed':
			return {error: IMPORT_FAILED_MESSAGE};
	}
}

export async function importPersonaAvatar(
	deps: PersonaAvatarImportDeps,
	userId: UserID,
	rawUrl: string,
): Promise<PersonaAvatarImportResult> {
	const outcome = await importOne(deps, userId, rawUrl);
	if (outcome.status === 'rate_limited') throw rateLimitError(outcome.rateLimit);
	return toResult(outcome);
}

interface PersonaAvatarBatchImport {
	run(options: {
		isCancelled: () => boolean;
		onResult: (url: string, result: PersonaAvatarImportResult, completed: number) => Promise<void>;
	}): Promise<Record<string, PersonaAvatarImportResult>>;
}

// Refuses the batch before any streaming starts when it cannot be afforded or when the user already
// has one running, so the caller gets an ordinary 429. Each fetch is still charged individually as
// it starts: a cancelled batch only pays for what it fetched, and the single-import route draws on
// the same bucket in the meantime.
export async function beginPersonaAvatarBatchImport(
	deps: PersonaAvatarImportDeps,
	userId: UserID,
	urls: ReadonlyArray<string>,
): Promise<PersonaAvatarBatchImport> {
	const quota = await deps.rateLimitService.peekLimit({
		identifier: quotaIdentifier(userId),
		...PERSONA_AVATAR_IMPORT_QUOTA,
	});
	if (quota.remaining < urls.length) {
		const shortfall = urls.length - quota.remaining;
		const retryAfterDecimal =
			(shortfall / PERSONA_AVATAR_IMPORT_QUOTA.maxAttempts) * (PERSONA_AVATAR_IMPORT_QUOTA.windowMs / 1000);
		throw rateLimitError({...quota, retryAfter: Math.ceil(retryAfterDecimal), retryAfterDecimal});
	}
	const lockKey = batchLockKey(userId);
	const lockToken = await deps.cacheService.acquireLock(lockKey, BATCH_LOCK_TTL_SECONDS);
	if (!lockToken) {
		throw rateLimitError({
			...quota,
			retryAfter: BATCH_LOCK_RETRY_AFTER_SECONDS,
			retryAfterDecimal: BATCH_LOCK_RETRY_AFTER_SECONDS,
		});
	}
	return {
		async run({isCancelled, onResult}) {
			const results: Record<string, PersonaAvatarImportResult> = {};
			let nextIndex = 0;
			let completed = 0;
			const worker = async () => {
				while (nextIndex < urls.length && !isCancelled()) {
					const url = urls[nextIndex++] as string;
					// The lock is short and renewed per fetch, so a crashed process frees the user quickly.
					await deps.cacheService.extendLock(lockKey, lockToken, BATCH_LOCK_TTL_SECONDS).catch(() => false);
					const result = toResult(await importOne(deps, userId, url));
					results[url] = result;
					completed++;
					await onResult(url, result, completed);
				}
			};
			try {
				await Promise.all(Array.from({length: Math.min(BATCH_CONCURRENCY, urls.length)}, () => worker()));
			} finally {
				await deps.cacheService.releaseLock(lockKey, lockToken).catch((error: unknown) => {
					Logger.warn({error, lockKey}, 'Failed to release persona avatar batch import lock');
				});
			}
			return results;
		},
	};
}
