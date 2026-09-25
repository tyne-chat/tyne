// SPDX-License-Identifier: AGPL-3.0-or-later

import {DefaultUserOnly, LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {deriveDominantAvatarColor} from '@app/api/utils/AvatarColorUtils';
import {Validator} from '@app/api/Validator';
import {validateOutboundEndpointUrl} from '@fluxer/hono/src/security/OutboundEndpoint';
import {SuccessResponse} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {streamText} from 'hono/streaming';
import {z} from 'zod';

const PersonaAvatarUploadRequest = z.object({
	avatar: z.string().describe('Base64 data URI of the avatar image'),
});
const SubprofileAvatarUploadRequest = PersonaAvatarUploadRequest;
const PersonaAvatarUploadResponse = z.object({
	avatar_url: z.string().describe('CDN URL of the uploaded avatar'),
	avatar_color: z.number().int().nullish().optional().describe('Dominant avatar color'),
});
const SubprofileAvatarUploadResponse = PersonaAvatarUploadResponse;

const PersonaBannerUploadRequest = z.object({
	banner: z.string().describe('Base64 data URI of the banner image'),
});
const SubprofileBannerUploadRequest = PersonaBannerUploadRequest;
const PersonaBannerUploadResponse = z.object({
	banner_url: z.string().describe('CDN URL of the uploaded banner'),
});
const SubprofileBannerUploadResponse = PersonaBannerUploadResponse;

const PersonaAvatarImportRequest = z.object({
	url: z.string().url().max(2048).describe('Remote URL of the avatar image to import'),
});
const SubprofileAvatarImportRequest = PersonaAvatarImportRequest;
const PersonaAvatarImportResponse = z.object({
	avatar_url: z.string().describe('CDN URL of the imported avatar'),
	avatar_color: z.number().int().nullish().optional().describe('Dominant avatar color'),
});
const SubprofileAvatarImportResponse = PersonaAvatarImportResponse;

const PersonaBatchAvatarImportRequest = z.object({
	urls: z.array(z.string().url().max(2048)).min(1).max(500).describe('List of remote avatar URLs to import'),
});
const SubprofileBatchAvatarImportRequest = PersonaBatchAvatarImportRequest;

// Fork: the fork's account routes. UserAccountController() registers them with one call at the
// place they had among its own, so every route keeps its order.
export function ForkUserAccountRoutes(app: HonoApp): void {
	const handlePersonaAvatarUpload = async (ctx: any) => {
		const user = ctx.get('user');
		const body = ctx.req.valid('json');
		const entityAssetService = ctx.get('entityAssetService');
		const prepared = await entityAssetService.prepareAssetUpload({
			assetType: 'avatar',
			entityType: 'user',
			entityId: user.id,
			previousHash: null,
			base64Image: body.avatar,
			errorPath: 'avatar',
		});
		await entityAssetService.commitAssetChange({prepared});
		const avatarColor = prepared.imageBuffer ? await deriveDominantAvatarColor(prepared.imageBuffer) : null;
		return ctx.json({avatar_url: prepared.newCdnUrl ?? '', avatar_color: avatarColor});
	};

	const handlePersonaBannerUpload = async (ctx: any) => {
		const user = ctx.get('user');
		const body = ctx.req.valid('json');
		const entityAssetService = ctx.get('entityAssetService');
		const prepared = await entityAssetService.prepareAssetUpload({
			assetType: 'banner',
			entityType: 'user',
			entityId: user.id,
			previousHash: null,
			base64Image: body.banner,
			errorPath: 'banner',
		});
		await entityAssetService.commitAssetChange({prepared});
		return ctx.json({banner_url: prepared.newCdnUrl ?? ''});
	};

	async function processRemoteAvatar(
		rawUrl: string,
		userId: string,
		entityAssetService: any,
	): Promise<{avatar_url?: string; avatar_color?: number | null; error?: string}> {
		try {
			validateOutboundEndpointUrl(rawUrl, {
				name: 'Avatar URL',
				allowHttp: true,
				allowLocalhost: false,
				allowPrivateIpLiterals: false,
				allowQuery: true,
				allowFragment: true,
			});
		} catch (err: unknown) {
			return {error: err instanceof Error ? err.message : 'Invalid avatar URL'};
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 12000);
		let fetchRes: Response;
		try {
			fetchRes = await fetch(rawUrl, {
				signal: controller.signal,
				headers: {
					'User-Agent': 'Fluxer/1.0 (Persona Avatar Importer)',
					Accept: 'image/*',
				},
			});
		} catch (err: unknown) {
			clearTimeout(timeout);
			const errorMsg = err instanceof Error ? err.message : 'Network error';
			return {error: `Failed to download image from host: ${errorMsg}`};
		} finally {
			clearTimeout(timeout);
		}

		if (!fetchRes.ok) {
			return {error: `Image host responded with HTTP ${fetchRes.status} ${fetchRes.statusText}`};
		}

		const contentType = fetchRes.headers.get('content-type') || 'image/png';
		const arrayBuf = await fetchRes.arrayBuffer();
		if (arrayBuf.byteLength > 10 * 1024 * 1024) {
			return {error: 'Image exceeds maximum 10MB limit'};
		}

		const base64Data = Buffer.from(arrayBuf).toString('base64');
		const base64Image = `data:${contentType};base64,${base64Data}`;

		try {
			const prepared = await entityAssetService.prepareAssetUpload({
				assetType: 'avatar',
				entityType: 'user',
				entityId: userId,
				previousHash: null,
				base64Image,
				errorPath: 'avatar',
			});
			await entityAssetService.commitAssetChange({prepared});
			const avatarColor = prepared.imageBuffer ? await deriveDominantAvatarColor(prepared.imageBuffer) : null;
			return {avatar_url: prepared.newCdnUrl ?? '', avatar_color: avatarColor};
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : 'Failed to process image';
			return {error: errorMsg};
		}
	}

	const handlePersonaAvatarImport = async (ctx: any) => {
		const user = ctx.get('user');
		const body = ctx.req.valid('json');
		const entityAssetService = ctx.get('entityAssetService');

		const result = await processRemoteAvatar(body.url, user.id, entityAssetService);
		if (result.error) {
			return ctx.json({message: result.error}, 400 as any);
		}
		return ctx.json({avatar_url: result.avatar_url ?? '', avatar_color: result.avatar_color ?? null});
	};

	const handlePersonaBatchAvatarImport = async (ctx: any) => {
		const user = ctx.get('user');
		const body = ctx.req.valid('json');
		const entityAssetService = ctx.get('entityAssetService');

		const rawUrls = body.urls as Array<string>;
		const uniqueUrls = Array.from(new Set(rawUrls));
		const total = uniqueUrls.length;

		const res = streamText(ctx, async (stream) => {
			let aborted = false;
			stream.onAbort(() => {
				aborted = true;
			});

			await stream.writeln(
				JSON.stringify({
					type: 'start',
					total,
				}),
			);

			const results: Record<string, {avatar_url?: string; avatar_color?: number | null; error?: string}> = {};
			let completedCount = 0;
			let currentIndex = 0;
			const CONCURRENCY = 4;

			const worker = async () => {
				while (currentIndex < uniqueUrls.length && !aborted) {
					const idx = currentIndex++;
					const url = uniqueUrls[idx];
					const r = await processRemoteAvatar(url, user.id, entityAssetService);
					results[url] = r;
					completedCount++;

					if (!aborted) {
						try {
							await stream.writeln(
								JSON.stringify({
									type: 'progress',
									completed: completedCount,
									total,
									url,
									avatar_url: r.avatar_url,
									avatar_color: r.avatar_color,
									error: r.error,
								}),
							);
						} catch {
							aborted = true;
							break;
						}
					}
				}
			};

			const workerCount = Math.min(CONCURRENCY, total);
			const workers = Array.from({length: workerCount}, () => worker());
			await Promise.all(workers);

			if (!aborted) {
				await stream.writeln(
					JSON.stringify({
						type: 'complete',
						total,
						results,
					}),
				);
			}
		});

		ctx.header('Content-Type', 'application/x-ndjson');
		return res;
	};

	app.post(
		'/users/@me/personas/avatar',
		RateLimitMiddleware(RateLimitConfigs.USER_UPDATE_SELF),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaAvatarUploadRequest),
		OpenAPI({
			operationId: 'upload_persona_avatar',
			summary: 'Upload persona avatar',
			responseSchema: PersonaAvatarUploadResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description: 'Uploads and processes an avatar image for a persona, hosting it on the instance CDN/storage.',
		}),
		handlePersonaAvatarUpload,
	);
	app.post(
		'/users/@me/subprofiles/avatar',
		RateLimitMiddleware(RateLimitConfigs.USER_UPDATE_SELF),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', SubprofileAvatarUploadRequest),
		OpenAPI({
			operationId: 'upload_subprofile_avatar',
			summary: 'Upload subprofile avatar (legacy alias)',
			responseSchema: SubprofileAvatarUploadResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description:
				'Uploads and processes an avatar image for a subprofile/persona, hosting it on the instance CDN/storage.',
		}),
		handlePersonaAvatarUpload,
	);
	app.post(
		'/users/@me/personas/banner',
		RateLimitMiddleware(RateLimitConfigs.USER_UPDATE_SELF),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaBannerUploadRequest),
		OpenAPI({
			operationId: 'upload_persona_banner',
			summary: 'Upload persona banner',
			responseSchema: PersonaBannerUploadResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description: 'Uploads and processes a banner image for a persona, hosting it on the instance CDN/storage.',
		}),
		handlePersonaBannerUpload,
	);
	app.post(
		'/users/@me/subprofiles/banner',
		RateLimitMiddleware(RateLimitConfigs.USER_UPDATE_SELF),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', SubprofileBannerUploadRequest),
		OpenAPI({
			operationId: 'upload_subprofile_banner',
			summary: 'Upload subprofile banner (legacy alias)',
			responseSchema: SubprofileBannerUploadResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description:
				'Uploads and processes a banner image for a subprofile/persona, hosting it on the instance CDN/storage.',
		}),
		handlePersonaBannerUpload,
	);
	app.post(
		'/users/@me/personas/import-avatar',
		RateLimitMiddleware(RateLimitConfigs.USER_UPDATE_SELF),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaAvatarImportRequest),
		OpenAPI({
			operationId: 'import_persona_avatar',
			summary: 'Import persona avatar from remote URL',
			responseSchema: PersonaAvatarImportResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description: 'Downloads an avatar image from an external URL and stores it on the instance CDN/storage.',
		}),
		handlePersonaAvatarImport,
	);
	app.post(
		'/users/@me/subprofiles/import-avatar',
		RateLimitMiddleware(RateLimitConfigs.USER_UPDATE_SELF),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', SubprofileAvatarImportRequest),
		OpenAPI({
			operationId: 'import_subprofile_avatar',
			summary: 'Import subprofile avatar from remote URL (legacy alias)',
			responseSchema: SubprofileAvatarImportResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description: 'Downloads an avatar image from an external URL and stores it on the instance CDN/storage.',
		}),
		handlePersonaAvatarImport,
	);
	app.post(
		'/users/@me/personas/import-batch-avatars',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_BATCH_AVATAR_IMPORT),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaBatchAvatarImportRequest),
		OpenAPI({
			operationId: 'import_persona_batch_avatars',
			summary: 'Batch import persona avatars from remote URLs with streaming progress',
			responseSchema: SuccessResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description:
				'Downloads up to 500 avatar images from external URLs and stores them on the instance CDN/storage, streaming NDJSON progress events.',
		}),
		handlePersonaBatchAvatarImport,
	);
	app.post(
		'/users/@me/subprofiles/import-batch-avatars',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_BATCH_AVATAR_IMPORT),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', SubprofileBatchAvatarImportRequest),
		OpenAPI({
			operationId: 'import_subprofile_batch_avatars',
			summary: 'Batch import subprofile avatars from remote URLs (legacy alias)',
			responseSchema: SuccessResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description:
				'Downloads up to 500 avatar images from external URLs and stores them on the instance CDN/storage, streaming NDJSON progress events.',
		}),
		handlePersonaBatchAvatarImport,
	);
}
