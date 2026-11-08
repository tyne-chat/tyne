// SPDX-License-Identifier: AGPL-3.0-or-later

import {Readable} from 'node:stream';
import {UserIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	PersonaBulkDeleteRequestSchema,
	PersonaBulkImportRequestSchema,
	PersonaChannelStateParam,
	PersonaChannelStateSchema,
	PersonaChannelStatesResponseSchema,
	PersonaChannelStateUpdateRequestSchema,
	PersonaCreateRequestSchema,
	PersonaExportResponse,
	PersonaIdParam,
	PersonaImportImageRequest,
	PersonaImportImageResponse,
	PersonaImportQuerySchema,
	PersonaListResponseSchema,
	PersonaResponseSchema,
	PersonaSettingsResponseSchema,
	PersonaSettingsUpdateRequestSchema,
	PersonaUpdateRequestSchema,
	PersonaVisibilityBulkRequestSchema,
	PublicPersonaListResponseSchema,
	PublicPersonaResponseSchema,
	UserIdPersonaIdParam,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {
	DeletedPersonaListResponseSchema,
	PersonaImportApplyRequestSchema,
	PersonaImportApplyResponseSchema,
	PersonaImportPreviewRequestSchema,
	PersonaImportPreviewResponseSchema,
	PersonaRestoreResponseSchema,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {
	PersonaLookupRequestSchema,
	PersonaLookupResponseSchema,
} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {createChannelID, createPersonaID, createUserID} from '../BrandedTypes';
import {viewerFromCtx} from '../experiment/ChannelThreadsGate';
import {DefaultUserOnly, LoginRequired} from '../middleware/AuthMiddleware';
import {requireOAuth2ScopeForBearer} from '../middleware/OAuth2ScopeMiddleware';
import {RateLimitMiddleware} from '../middleware/RateLimitMiddleware';
import {OpenAPI} from '../middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '../RateLimitConfig';
import type {HonoApp} from '../types/HonoEnv';
import {Validator} from '../Validator';
import {importPersonaImageUpload} from './PersonaAvatarImporter';
import {createPersonaExportArchive} from './PersonaExportService';

export function PersonaController(app: HonoApp) {
	app.get(
		'/users/@me/personas',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_LIST),
		requireOAuth2ScopeForBearer('personas.read'),
		LoginRequired,
		DefaultUserOnly,
		OpenAPI({
			operationId: 'list_my_personas',
			summary: 'List own personas',
			responseSchema: PersonaListResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Retrieves all personas created and owned by the authenticated user.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const personas = await ctx.get('personaService').getPersonas(user.id);
			return ctx.json(personas.map((p) => p.toResponse()));
		},
	);

	app.post(
		'/users/@me/personas',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaCreateRequestSchema),
		OpenAPI({
			operationId: 'create_persona',
			summary: 'Create persona',
			responseSchema: PersonaResponseSchema,
			statusCode: 201,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Creates a new persona for the authenticated user.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const body = ctx.req.valid('json');
			const persona = await ctx.get('personaService').createPersona(user.id, body);
			return ctx.json(persona.toResponse(), 201);
		},
	);

	app.post(
		'/users/@me/personas/import',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaBulkImportRequestSchema),
		Validator('query', PersonaImportQuerySchema),
		OpenAPI({
			operationId: 'import_personas',
			summary: 'Bulk import personas',
			responseSchema: PersonaListResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				'Imports or synchronizes personas in bulk (e.g. from PluralKit or Tupperbox). The whole request is checked first and written at once: if it is refused, nothing changes.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const body = ctx.req.valid('json');
			const {replace} = ctx.req.valid('query');
			const personas = await ctx.get('personaService').importPersonas(user.id, body, {replace});
			return ctx.json(personas.map((p) => p.toResponse()));
		},
	);

	// Fork: the reviewed import (tyne-chat/tyne#243). The older import above stays for desktop apps
	// that have not updated yet.
	app.post(
		'/users/@me/personas/import/preview',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_READ),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaImportPreviewRequestSchema),
		OpenAPI({
			operationId: 'preview_persona_import',
			summary: 'Preview a persona import',
			responseSchema: PersonaImportPreviewResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				"Classifies each member of an import file against the account's personas, deleted ones included: linked and identical, linked and different, deleted, probably the same, can't tell, tag in use, or new. Changes nothing. Pictures are compared only where their origin is known; links in the request are never fetched.",
		}),
		async (ctx) => {
			const user = ctx.get('user');
			return ctx.json(await ctx.get('personaService').previewImport(user.id, ctx.req.valid('json')));
		},
	);

	app.post(
		'/users/@me/personas/import/apply',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaImportApplyRequestSchema),
		OpenAPI({
			operationId: 'apply_persona_import',
			summary: 'Apply a reviewed persona import',
			responseSchema: PersonaImportApplyResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				"Applies one action per member: add, link (record the member's id only), restore (bring back the same deleted persona) or use_file (replace a linked persona's details, never its visibility). Checked against the account as it is now and written at once: if it is refused, nothing changes. Nothing is deleted.",
		}),
		async (ctx) => {
			const user = ctx.get('user');
			return ctx.json(await ctx.get('personaService').applyImport(user.id, ctx.req.valid('json')));
		},
	);

	app.get(
		'/users/@me/personas/deleted',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_READ),
		requireOAuth2ScopeForBearer('personas.read'),
		LoginRequired,
		DefaultUserOnly,
		OpenAPI({
			operationId: 'list_my_deleted_personas',
			summary: 'List own deleted personas',
			responseSchema: DeletedPersonaListResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				'Lists the deleted personas of the authenticated user, the most recently deleted first. They still show on their old messages and can be restored.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const personas = await ctx.get('personaService').listDeletedPersonas(user.id);
			return ctx.json(personas.map((p) => p.toResponse()));
		},
	);

	app.post(
		'/users/@me/personas/deleted/:persona_id/restore',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', PersonaIdParam),
		OpenAPI({
			operationId: 'restore_persona',
			summary: 'Restore a deleted persona',
			responseSchema: PersonaRestoreResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				'Brings back a deleted persona as it was, so its old messages and usage are its own again. Tags and signature emojis another persona holds now are left off and listed in the response.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {persona_id} = ctx.req.valid('param');
			return ctx.json(await ctx.get('personaService').restorePersona(user.id, createPersonaID(BigInt(persona_id))));
		},
	);

	app.patch(
		'/users/@me/personas/visibility',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaVisibilityBulkRequestSchema),
		OpenAPI({
			operationId: 'set_persona_visibilities',
			summary: 'Change the visibility of several personas',
			responseSchema: PersonaListResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				'Gives each named persona its own new visibility, in one write: if one of them is not yours or is deleted, nothing changes. Returns the personas that changed.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {personas} = ctx.req.valid('json');
			const changed = await ctx.get('personaService').setPersonaVisibilities(
				user.id,
				personas.map(({id, visibility}) => ({personaId: createPersonaID(BigInt(id)), visibility})),
			);
			return ctx.json(changed.map((p) => p.toResponse()));
		},
	);

	app.post(
		'/users/@me/personas/bulk-delete',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaBulkDeleteRequestSchema),
		OpenAPI({
			operationId: 'delete_personas',
			summary: 'Delete several personas',
			responseSchema: null,
			statusCode: 204,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				'Deletes the named personas in one write, as deleting each would: their messages keep showing them. If one of them is not yours or is already deleted, nothing changes.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {persona_ids} = ctx.req.valid('json');
			await ctx.get('personaService').deletePersonas(
				user.id,
				persona_ids.map((id) => createPersonaID(BigInt(id))),
			);
			return ctx.body(null, 204);
		},
	);

	app.get(
		'/users/@me/personas/settings',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_READ),
		requireOAuth2ScopeForBearer('personas.read'),
		LoginRequired,
		DefaultUserOnly,
		OpenAPI({
			operationId: 'get_my_persona_settings',
			summary: 'Get own persona settings',
			responseSchema: PersonaSettingsResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Retrieves persona settings (active mode, display tag, latch state) for the authenticated user.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const settings = await ctx.get('personaService').getSettings(user.id);
			return ctx.json(settings);
		},
	);

	app.patch(
		'/users/@me/personas/settings',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaSettingsUpdateRequestSchema),
		OpenAPI({
			operationId: 'update_my_persona_settings',
			summary: 'Update own persona settings',
			responseSchema: PersonaSettingsResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Updates persona settings (active mode, display tag, latch state) for the authenticated user.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const body = ctx.req.valid('json');
			const settings = await ctx.get('personaService').updateSettings(user.id, body);
			return ctx.json(settings);
		},
	);

	// Before the `:persona_id` routes, so that "export" is not read as an ID.
	app.get(
		'/users/@me/personas/export',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_EXPORT),
		requireOAuth2ScopeForBearer('personas.read'),
		LoginRequired,
		DefaultUserOnly,
		OpenAPI({
			operationId: 'export_my_personas',
			summary: 'Export own personas',
			responseSchema: PersonaExportResponse,
			responseContentType: 'application/zip',
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				"Exports all personas of the authenticated user as a ZIP file: a PluralKit export file (pluralkit.json), each persona's avatar and banner and the tag icon, tyne.json listing which image belongs to which persona, and a README. Importing the ZIP gives the personas back.",
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {fileName, stream} = await createPersonaExportArchive(
				{personaService: ctx.get('personaService'), storageService: ctx.get('storageService')},
				user.id,
			);
			const headers = new Headers();
			headers.set('Content-Type', 'application/zip');
			headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
			headers.set('Cache-Control', 'private, no-store');
			return new Response(Readable.toWeb(stream) as ReadableStream, {status: 200, headers});
		},
	);

	app.post(
		'/users/@me/personas/import-image',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_IMAGE_IMPORT),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaImportImageRequest),
		OpenAPI({
			operationId: 'import_persona_image',
			summary: 'Store an image from a persona export being imported',
			responseSchema: PersonaImportImageResponse,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				'Stores one avatar or banner image read from a persona export ZIP that the user is importing, and returns its hash for use in the import. Counts against the persona image import quota.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {kind, image} = ctx.req.valid('json');
			const result = await importPersonaImageUpload(
				{
					mediaService: ctx.get('mediaService'),
					entityAssetService: ctx.get('entityAssetService'),
					rateLimitService: ctx.get('rateLimitService'),
					cacheService: ctx.get('cacheService'),
				},
				user.id,
				kind,
				image,
			);
			return ctx.json(result);
		},
	);

	// These two sit before the `:persona_id` routes so that "channel-states" is not read as an ID.
	app.get(
		'/users/@me/personas/channel-states',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_READ),
		requireOAuth2ScopeForBearer('personas.read'),
		LoginRequired,
		DefaultUserOnly,
		OpenAPI({
			operationId: 'list_my_persona_channel_states',
			summary: 'List the personas selected per channel',
			responseSchema: PersonaChannelStatesResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				'Lists every channel the authenticated user has a persona selected in. Used when their persona is remembered per channel; a channel that is not listed is used as the account itself.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			return ctx.json(await ctx.get('personaService').getChannelStates(user.id));
		},
	);

	app.put(
		'/users/@me/personas/channel-states/:channel_id',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', PersonaChannelStateParam),
		Validator('json', PersonaChannelStateUpdateRequestSchema),
		OpenAPI({
			operationId: 'set_my_persona_channel_state',
			summary: 'Select a persona in a channel',
			responseSchema: PersonaChannelStateSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description:
				"Selects one of the authenticated user's personas in a channel they can see, or the account itself with a null persona. Only their own sessions are told.",
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const {persona_id} = ctx.req.valid('json');
			// Refuses a channel the account cannot see, which also keeps the rows to real channels.
			await ctx
				.get('channelService')
				.interactions.authService.getChannelAuthenticated({userId: user.id, channelId, viewer: viewerFromCtx(ctx)});
			const state = await ctx
				.get('personaService')
				.setChannelState(user.id, channelId, persona_id === null ? null : createPersonaID(BigInt(persona_id)));
			return ctx.json(state);
		},
	);

	app.get(
		'/users/@me/personas/:persona_id',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_READ),
		requireOAuth2ScopeForBearer('personas.read'),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', PersonaIdParam),
		OpenAPI({
			operationId: 'get_my_persona',
			summary: 'Get own persona by ID',
			responseSchema: PersonaResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Retrieves a single persona owned by the authenticated user.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {persona_id} = ctx.req.valid('param');
			const persona = await ctx.get('personaService').getPersona(user.id, createPersonaID(BigInt(persona_id)));
			return ctx.json(persona.toResponse());
		},
	);

	app.patch(
		'/users/@me/personas/:persona_id',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', PersonaIdParam),
		Validator('json', PersonaUpdateRequestSchema),
		OpenAPI({
			operationId: 'update_persona',
			summary: 'Update persona',
			responseSchema: PersonaResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Updates properties of an existing persona owned by the authenticated user.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {persona_id} = ctx.req.valid('param');
			const body = ctx.req.valid('json');
			const persona = await ctx.get('personaService').updatePersona(user.id, createPersonaID(BigInt(persona_id)), body);
			return ctx.json(persona.toResponse());
		},
	);

	app.delete(
		'/users/@me/personas/:persona_id',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_MUTATE),
		requireOAuth2ScopeForBearer('personas.write'),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', PersonaIdParam),
		OpenAPI({
			operationId: 'delete_persona',
			summary: 'Delete persona',
			responseSchema: null,
			statusCode: 204,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Deletes an existing persona owned by the authenticated user.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {persona_id} = ctx.req.valid('param');
			await ctx.get('personaService').deletePersona(user.id, createPersonaID(BigInt(persona_id)));
			return ctx.body(null, 204);
		},
	);

	app.get(
		'/users/:user_id/personas',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_LIST),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', UserIdParam),
		OpenAPI({
			operationId: 'list_user_public_personas',
			summary: 'List user public personas',
			responseSchema: PublicPersonaListResponseSchema,
			statusCode: 200,
			security: ['sessionToken'],
			tags: ['Personas'],
			description:
				"Retrieves a user's public personas, the most used first, with the user's display tag, if mutual context permits.",
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {user_id} = ctx.req.valid('param');
			const publicPersonas = await ctx.get('personaService').getPublicPersonas(user.id, createUserID(BigInt(user_id)));
			return ctx.json(publicPersonas);
		},
	);

	app.post(
		'/personas/lookup',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_READ),
		LoginRequired,
		DefaultUserOnly,
		Validator('json', PersonaLookupRequestSchema),
		OpenAPI({
			operationId: 'lookup_personas',
			summary: 'Look up personas by ID',
			responseSchema: PersonaLookupResponseSchema,
			statusCode: 200,
			security: ['sessionToken'],
			tags: ['Personas'],
			description:
				'Returns what messages from the given personas show (name, avatar, colours, display tag), whatever their visibility, including deleted ones, each with its owner. Nothing of their profiles. Pairs that name no persona of that user are left out.',
		}),
		async (ctx) => {
			const {personas} = ctx.req.valid('json');
			const found = await ctx.get('personaService').lookupPersonas(
				personas.map(({user_id, persona_id}) => ({
					userId: createUserID(BigInt(user_id)),
					personaId: createPersonaID(BigInt(persona_id)),
				})),
			);
			return ctx.json(found);
		},
	);

	app.get(
		'/users/:user_id/personas/:persona_id',
		RateLimitMiddleware(RateLimitConfigs.USER_PERSONA_READ),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', UserIdPersonaIdParam),
		OpenAPI({
			operationId: 'get_user_persona_by_id',
			summary: 'Get persona profile card by ID',
			responseSchema: PublicPersonaResponseSchema,
			statusCode: 200,
			security: ['sessionToken'],
			tags: ['Personas'],
			description: 'Retrieves public or unlisted profile details for a persona if mutual context permits.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {user_id, persona_id} = ctx.req.valid('param');
			const publicPersona = await ctx
				.get('personaService')
				.getPublicPersonaById(user.id, createUserID(BigInt(user_id)), createPersonaID(BigInt(persona_id)));
			return ctx.json(publicPersona);
		},
	);
}
