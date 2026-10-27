// SPDX-License-Identifier: AGPL-3.0-or-later

import {DefaultUserOnly, LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {beginPersonaAvatarBatchImport, importPersonaAvatar} from '@app/api/persona/PersonaAvatarImporter';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {deriveDominantAvatarColor} from '@app/api/utils/AvatarColorUtils';
import {Validator} from '@app/api/Validator';
import {
	PersonaAvatarImportRequest,
	PersonaAvatarImportResponse,
	PersonaAvatarUploadRequest,
	PersonaAvatarUploadResponse,
	PersonaBannerUploadRequest,
	PersonaBannerUploadResponse,
	PersonaBatchAvatarImportRequest,
	PersonaBatchAvatarImportStream,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {streamText} from 'hono/streaming';

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
		return ctx.json({avatar_hash: prepared.newHash ?? '', avatar_color: avatarColor});
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
		return ctx.json({banner_hash: prepared.newHash ?? ''});
	};

	const personaAvatarImportDeps = (ctx: any) => ({
		mediaService: ctx.get('mediaService'),
		entityAssetService: ctx.get('entityAssetService'),
		rateLimitService: ctx.get('rateLimitService'),
		cacheService: ctx.get('cacheService'),
	});

	const handlePersonaAvatarImport = async (ctx: any) => {
		const user = ctx.get('user');
		const body = ctx.req.valid('json');

		const result = await importPersonaAvatar(personaAvatarImportDeps(ctx), user.id, body.url);
		if (result.error) {
			return ctx.json({message: result.error}, 400 as any);
		}
		return ctx.json({avatar_hash: result.avatar_hash ?? '', avatar_color: result.avatar_color ?? null});
	};

	const handlePersonaBatchAvatarImport = async (ctx: any) => {
		const user = ctx.get('user');
		const body = ctx.req.valid('json');

		const rawUrls = body.urls as Array<string>;
		const uniqueUrls = Array.from(new Set(rawUrls));
		const total = uniqueUrls.length;
		const batch = await beginPersonaAvatarBatchImport(personaAvatarImportDeps(ctx), user.id, uniqueUrls, body.kind);

		const res = streamText(ctx, async (stream) => {
			let aborted = false;
			stream.onAbort(() => {
				aborted = true;
			});
			const write = async (event: Record<string, unknown>) => {
				if (aborted) return;
				try {
					await stream.writeln(JSON.stringify(event));
				} catch {
					aborted = true;
				}
			};

			await write({type: 'start', total});
			const results = await batch.run({
				isCancelled: () => aborted,
				onResult: (url, r, completed) =>
					write({
						type: 'progress',
						completed,
						total,
						url,
						avatar_hash: r.avatar_hash,
						avatar_color: r.avatar_color,
						banner_hash: r.banner_hash,
						error: r.error,
					}),
			});
			await write({type: 'complete', total, results});
		});

		res.headers.set('Content-Type', 'application/x-ndjson');
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
		'/users/@me/personas/import-batch-avatars',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_BATCH_AVATAR_IMPORT),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaBatchAvatarImportRequest),
		OpenAPI({
			operationId: 'import_persona_batch_avatars',
			summary: 'Batch import persona avatars from remote URLs with streaming progress',
			responseSchema: PersonaBatchAvatarImportStream,
			responseContentType: 'application/x-ndjson',
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Users'],
			description:
				'Downloads up to 500 avatar images from external URLs and stores them on the instance CDN/storage, streaming NDJSON progress events.',
		}),
		handlePersonaBatchAvatarImport,
	);
}
