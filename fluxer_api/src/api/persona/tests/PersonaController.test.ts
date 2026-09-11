// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {Config} from '../../Config';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

describe('PersonaController', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;

	beforeEach(async () => {
		harness = await createApiTestHarness();
		account = await createTestAccount(harness);
	});

	afterEach(() => {
		Config.dev.validateResponses = true;
	});

	describe('POST /users/@me/personas (Create)', () => {
		test('creates a persona with default unlisted visibility and valid snowflake ID', async () => {
			const res = await createBuilder<PersonaResponse>(harness, account.token)
				.post('/users/@me/personas')
				.body({
					name: 'Alvis',
					bio: 'A bookkeeper of sorts.',
					pronouns: 'they/it',
					color: 0x336699,
					persona_tags: [{prefix: 'a:'}],
				})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			expect(res.id).toMatch(/^\d{17,20}$/);
			expect(res.name).toBe('Alvis');
			expect(res.bio).toBe('A bookkeeper of sorts.');
			expect(res.pronouns).toBe('they/it');
			expect(res.color).toBe(0x336699);
			expect(res.visibility).toBe('unlisted');
			expect(res.persona_tags).toEqual([{prefix: 'a:'}]);
			expect(res.use_count).toBe(0);
		});

		test('creates a persona with explicit public or private visibility', async () => {
			const publicRes = await createBuilder<PersonaResponse>(harness, account.token)
				.post('/users/@me/personas')
				.body({
					name: 'Public Persona',
					visibility: 'public',
				})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			expect(publicRes.visibility).toBe('public');

			const privateRes = await createBuilder<PersonaResponse>(harness, account.token)
				.post('/users/@me/personas')
				.body({
					name: 'Private Persona',
					visibility: 'private',
				})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			expect(privateRes.visibility).toBe('private');
		});

		test('fails validation when name is empty or exceeds 100 characters', async () => {
			await createBuilder(harness, account.token)
				.post('/users/@me/personas')
				.body({name: ''})
				.expect(HTTP_STATUS.BAD_REQUEST)
				.execute();

			await createBuilder(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'a'.repeat(101)})
				.expect(HTTP_STATUS.BAD_REQUEST)
				.execute();
		});
	});

	describe('GET /users/@me/personas (List Self)', () => {
		test('lists all personas owned by user', async () => {
			await createBuilder(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'Persona 1', visibility: 'public'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			await createBuilder(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'Persona 2', visibility: 'unlisted'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			await createBuilder(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'Persona 3', visibility: 'private'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			const list = await createBuilder<Array<PersonaResponse>>(harness, account.token)
				.get('/users/@me/personas')
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(list).toHaveLength(3);
			const names = list.map((p) => p.name);
			expect(names).toContain('Persona 1');
			expect(names).toContain('Persona 2');
			expect(names).toContain('Persona 3');
		});
	});

	describe('GET /users/@me/personas/:persona_id (Get Self)', () => {
		test('returns persona by ID for owner', async () => {
			const created = await createBuilder<PersonaResponse>(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'Hikari', bio: 'Combat robot.'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			const fetched = await createBuilder<PersonaResponse>(harness, account.token)
				.get(`/users/@me/personas/${created.id}`)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(fetched.id).toBe(created.id);
			expect(fetched.name).toBe('Hikari');
			expect(fetched.bio).toBe('Combat robot.');
		});

		test('returns 404 for nonexistent persona or another user persona', async () => {
			const otherAccount = await createTestAccount(harness);
			const otherPersona = await createBuilder<PersonaResponse>(harness, otherAccount.token)
				.post('/users/@me/personas')
				.body({name: 'Other Persona'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			await createBuilder(harness, account.token)
				.get(`/users/@me/personas/${otherPersona.id}`)
				.expect(HTTP_STATUS.NOT_FOUND)
				.execute();

			await createBuilder(harness, account.token)
				.get('/users/@me/personas/123456789012345678')
				.expect(HTTP_STATUS.NOT_FOUND)
				.execute();
		});
	});

	describe('PATCH /users/@me/personas/:persona_id (Update Self)', () => {
		test('updates persona fields', async () => {
			const created = await createBuilder<PersonaResponse>(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'Initial Name', bio: 'Initial Bio', visibility: 'unlisted'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			const updated = await createBuilder<PersonaResponse>(harness, account.token)
				.patch(`/users/@me/personas/${created.id}`)
				.body({
					name: 'Updated Name',
					bio: 'Updated Bio',
					visibility: 'public',
					persona_tags: [{prefix: '[', suffix: ']'}],
				})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(updated.id).toBe(created.id);
			expect(updated.name).toBe('Updated Name');
			expect(updated.bio).toBe('Updated Bio');
			expect(updated.visibility).toBe('public');
			expect(updated.persona_tags).toEqual([{prefix: '[', suffix: ']'}]);
		});

		test('returns 404 when attempting to update another user persona', async () => {
			const otherAccount = await createTestAccount(harness);
			const otherPersona = await createBuilder<PersonaResponse>(harness, otherAccount.token)
				.post('/users/@me/personas')
				.body({name: 'Other Persona'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			await createBuilder(harness, account.token)
				.patch(`/users/@me/personas/${otherPersona.id}`)
				.body({name: 'Hijacked Name'})
				.expect(HTTP_STATUS.NOT_FOUND)
				.execute();
		});
	});

	describe('DELETE /users/@me/personas/:persona_id (Delete Self)', () => {
		test('deletes persona and returns 204', async () => {
			const created = await createBuilder<PersonaResponse>(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'To Delete'})
				.expect(HTTP_STATUS.CREATED)
				.execute();

			await createBuilder(harness, account.token)
				.delete(`/users/@me/personas/${created.id}`)
				.expect(HTTP_STATUS.NO_CONTENT)
				.execute();

			await createBuilder(harness, account.token)
				.get(`/users/@me/personas/${created.id}`)
				.expect(HTTP_STATUS.NOT_FOUND)
				.execute();
		});

		test('returns 404 when deleting nonexistent persona', async () => {
			await createBuilder(harness, account.token)
				.delete('/users/@me/personas/123456789012345678')
				.expect(HTTP_STATUS.NOT_FOUND)
				.execute();
		});
	});

	describe('POST /users/@me/personas/import (Bulk / PluralKit Import)', () => {
		test('imports multiple personas and idempotently upserts by external_uuid', async () => {
			const importBatch = [
				{
					name: 'PK Member 1',
					bio: 'First imported member',
					external_uuid: '00000000-0000-0000-0000-000000000001',
				},
				{
					name: 'PK Member 2',
					bio: 'Second imported member',
					external_uuid: '00000000-0000-0000-0000-000000000002',
				},
			];

			const firstImport = await createBuilder<Array<PersonaResponse>>(harness, account.token)
				.post('/users/@me/personas/import')
				.body(importBatch)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(firstImport).toHaveLength(2);
			const id1 = firstImport[0]!.id;
			const id2 = firstImport[1]!.id;
			expect(id1).toMatch(/^\d{17,20}$/);
			expect(id2).toMatch(/^\d{17,20}$/);
			expect(firstImport[0]!.external_uuid).toBe('00000000-0000-0000-0000-000000000001');

			// Re-import with modified bio
			const reimportBatch = [
				{
					name: 'PK Member 1 Renamed',
					bio: 'Updated bio on re-sync',
					external_uuid: '00000000-0000-0000-0000-000000000001',
				},
			];

			const secondImport = await createBuilder<Array<PersonaResponse>>(harness, account.token)
				.post('/users/@me/personas/import')
				.body(reimportBatch)
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(secondImport).toHaveLength(1);
			expect(secondImport[0]!.id).toBe(id1); // Native Snowflake preserved!
			expect(secondImport[0]!.name).toBe('PK Member 1 Renamed');
			expect(secondImport[0]!.bio).toBe('Updated bio on re-sync');

			// Check total count is still 2
			const all = await createBuilder<Array<PersonaResponse>>(harness, account.token)
				.get('/users/@me/personas')
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(all).toHaveLength(2);
		});

		test('imports personas wrapped in a { personas: [...] } object', async () => {
			const batch = [
				{
					name: 'Wrapped Import',
					visibility: 'unlisted',
				},
			];

			const res = await createBuilder<Array<PersonaResponse>>(harness, account.token)
				.post('/users/@me/personas/import')
				.body({personas: batch})
				.expect(HTTP_STATUS.OK)
				.execute();

			expect(res).toHaveLength(1);
			expect(res[0]!.name).toBe('Wrapped Import');
		});
	});
});
