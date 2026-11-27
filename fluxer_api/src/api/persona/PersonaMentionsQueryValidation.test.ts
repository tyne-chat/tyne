// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: regression guard verifying ChannelPersonaMentionsQuerySchema keeps empty `q=` (via
// preserveEmptyValues after .default('')), applies default limit when omitted, and rejects empty
// `limit=` via `.min(1)` (tyne-chat/tyne#200, tyne-chat/tyne#947).

import {Validator} from '@app/api/Validator';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {ChannelPersonaMentionsQuerySchema} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {Hono} from 'hono';
import {describe, expect, it} from 'vitest';

function createValidationApp(): Hono {
	const app = new Hono();
	app.onError((error, ctx) => {
		if (error instanceof InputValidationError) {
			return ctx.json({errors: error.getLocalizedErrors()}, 400);
		}
		throw error;
	});
	app.get('/mentions', Validator('query', ChannelPersonaMentionsQuerySchema), (ctx) =>
		ctx.json(ctx.req.valid('query')),
	);
	return app;
}

describe('ChannelPersonaMentionsQuerySchema HTTP query validation', () => {
	it('preserves empty q= and applies default limit when omitted', async () => {
		const app = createValidationApp();
		const res = await app.request('/mentions?q=');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({q: '', limit: 100});
	});

	it('parses valid integer limit values alongside query string q', async () => {
		const app = createValidationApp();
		const res = await app.request('/mentions?q=alice&limit=25');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({q: 'alice', limit: 25});
	});

	it('rejects empty limit= with 400 instead of silently returning zero results', async () => {
		const app = createValidationApp();
		const res = await app.request('/mentions?q=&limit=');
		expect(res.status).toBe(400);
	});
});
