// SPDX-License-Identifier: AGPL-3.0-or-later

import {DefaultUserOnly, LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {z} from 'zod';

const PersonaAvatarUploadRequest = z.object({
	avatar: z.string().describe('Base64 data URI of the avatar image'),
});
const SubprofileAvatarUploadRequest = PersonaAvatarUploadRequest;
const PersonaAvatarUploadResponse = z.object({
	avatar_url: z.string().describe('CDN URL of the uploaded avatar'),
});
const SubprofileAvatarUploadResponse = PersonaAvatarUploadResponse;

const PersonaAvatarImportRequest = z.object({
	url: z.string().url().max(2048).describe('Remote URL of the avatar image to import'),
});
const SubprofileAvatarImportRequest = PersonaAvatarImportRequest;
const PersonaAvatarImportResponse = z.object({
	avatar_url: z.string().describe('CDN URL of the imported avatar'),
});
const SubprofileAvatarImportResponse = PersonaAvatarImportResponse;

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
		return ctx.json({avatar_url: prepared.newCdnUrl ?? ''});
	};

	const handlePersonaAvatarImport = async (ctx: any) => {
		const user = ctx.get('user');
		const body = ctx.req.valid('json');

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 12000);
		let fetchRes: Response;
		try {
			fetchRes = await fetch(body.url, {
				signal: controller.signal,
				headers: {
					'User-Agent': 'Fluxer/1.0 (Persona Avatar Importer)',
					Accept: 'image/*',
				},
			});
		} catch (err: unknown) {
			clearTimeout(timeout);
			const errorMsg = err instanceof Error ? err.message : 'Network error';
			return ctx.json({message: `Failed to download image from host: ${errorMsg}`}, 400 as any);
		} finally {
			clearTimeout(timeout);
		}

		if (!fetchRes.ok) {
			return ctx.json(
				{message: `Image host responded with HTTP ${fetchRes.status} ${fetchRes.statusText}`},
				400 as any,
			);
		}

		const contentType = fetchRes.headers.get('content-type') || 'image/png';
		const arrayBuf = await fetchRes.arrayBuffer();
		if (arrayBuf.byteLength > 10 * 1024 * 1024) {
			return ctx.json({message: 'Image exceeds maximum 10MB limit'}, 400 as any);
		}

		const base64Data = Buffer.from(arrayBuf).toString('base64');
		const base64Image = `data:${contentType};base64,${base64Data}`;

		const entityAssetService = ctx.get('entityAssetService');
		const prepared = await entityAssetService.prepareAssetUpload({
			assetType: 'avatar',
			entityType: 'user',
			entityId: user.id,
			previousHash: null,
			base64Image,
			errorPath: 'avatar',
		});
		await entityAssetService.commitAssetChange({prepared});
		return ctx.json({avatar_url: prepared.newCdnUrl ?? ''});
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
}
