// SPDX-License-Identifier: AGPL-3.0-or-later

import {UserIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	PersonaBulkImportRequestSchema,
	PersonaCreateRequestSchema,
	PersonaIdParam,
	PersonaResponseSchema,
	PersonaUpdateRequestSchema,
	PublicPersonaResponseSchema,
	UserIdPersonaIdParam,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {z} from 'zod';
import {createPersonaID, createUserID} from '../BrandedTypes';
import {DefaultUserOnly, LoginRequired} from '../middleware/AuthMiddleware';
import {requireOAuth2ScopeForBearer} from '../middleware/OAuth2ScopeMiddleware';
import {RateLimitMiddleware} from '../middleware/RateLimitMiddleware';
import {OpenAPI} from '../middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '../RateLimitConfig';
import type {HonoApp} from '../types/HonoEnv';
import {Validator} from '../Validator';

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
			responseSchema: z.array(PersonaResponseSchema),
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
		OpenAPI({
			operationId: 'import_personas',
			summary: 'Bulk import personas',
			responseSchema: z.array(PersonaResponseSchema),
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: ['Personas'],
			description: 'Imports or synchronizes personas in bulk (e.g. from PluralKit or Tupperbox).',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const body = ctx.req.valid('json');
			const personas = await ctx.get('personaService').importPersonas(user.id, body);
			return ctx.json(personas.map((p) => p.toResponse()));
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
			responseSchema: z.array(PublicPersonaResponseSchema),
			statusCode: 200,
			security: ['sessionToken'],
			tags: ['Personas'],
			description: 'Retrieves public personas for a target user if mutual context permits.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {user_id} = ctx.req.valid('param');
			const publicPersonas = await ctx.get('personaService').getPublicPersonas(user.id, createUserID(BigInt(user_id)));
			return ctx.json(publicPersonas);
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
