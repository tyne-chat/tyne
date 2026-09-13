// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import type {
	PersonaCreateRequest,
	PersonaResponse,
	PublicPersonaResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {
		getSubPreference: () => undefined,
		setSubPreference: () => Promise.resolve(),
		isHydrated: true,
	},
}));

installVoiceMenuTestBootstrap();

const PersonaCommands = await import('./PersonaCommands');
const {PersonaStore} = await import('../state/PersonaStore');

vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {
		get: vi.fn(),
		post: vi.fn(),
		patch: vi.fn(),
		delete: vi.fn(),
		configure: vi.fn(),
	},
}));

vi.mock('@app/features/ui/commands/ToastCommands', () => ({
	createToast: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));

describe('PersonaCommands', () => {
	beforeEach(() => {
		PersonaStore.clear();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('fetchPersonas', () => {
		it('fetches personas from REST API and updates PersonaStore', async () => {
			const mockPersonas: Array<PersonaResponse> = [
				{
					id: '1540000000000000001',
					name: 'Alice',
					avatar_url: 'https://example.com/avatar1.png',
					system_name: 'Sys',
					pronouns: 'she/her',
					color: 0x123456,
					bio: 'Alice bio',
					auto_tag_disabled: false,
					persona_tags: [{prefix: '[', suffix: ']'}],
					use_count: 5,
					last_used_at_ms: '1700000000000',
					visibility: 'unlisted',
					external_uuid: null,
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-01T00:00:00Z',
				},
			];

			vi.mocked(http.get).mockResolvedValueOnce({
				ok: true,
				status: 200,
				body: mockPersonas,
			} as any);

			const result = await PersonaCommands.fetchPersonas();
			expect(http.get).toHaveBeenCalledWith(Endpoints.USER_PERSONAS);
			expect(result).toEqual(mockPersonas);
			expect(PersonaStore.personas.length).toBe(1);
			expect(PersonaStore.personas[0].name).toBe('Alice');
		});

		it('returns empty array on failure without crashing', async () => {
			vi.mocked(http.get).mockResolvedValueOnce({
				ok: false,
				status: 500,
				body: null,
			} as any);

			const result = await PersonaCommands.fetchPersonas();
			expect(result).toEqual([]);
		});

		it('returns empty array when http request throws an error', async () => {
			vi.mocked(http.get).mockRejectedValueOnce(new Error('Network failure'));

			const result = await PersonaCommands.fetchPersonas();
			expect(result).toEqual([]);
		});
	});

	describe('createPersona', () => {
		it('creates persona via POST and upserts to store', async () => {
			const request: PersonaCreateRequest = {
				name: 'Bob',
				visibility: 'public',
				persona_tags: [{prefix: 'b:'}],
			};

			const createdResponse: PersonaResponse = {
				id: '1540000000000000002',
				name: 'Bob',
				avatar_url: null,
				system_name: null,
				pronouns: null,
				color: null,
				bio: null,
				auto_tag_disabled: false,
				persona_tags: [{prefix: 'b:'}],
				use_count: 0,
				last_used_at_ms: null,
				visibility: 'public',
				external_uuid: null,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
			};

			vi.mocked(http.post).mockResolvedValueOnce({
				ok: true,
				status: 201,
				body: createdResponse,
			} as any);

			const res = await PersonaCommands.createPersona(request);
			expect(http.post).toHaveBeenCalledWith(Endpoints.USER_PERSONAS, {body: request});
			expect(res).toEqual(createdResponse);
			expect(PersonaStore.personas.length).toBe(1);
			expect(PersonaStore.personas[0].id).toBe('1540000000000000002');
			expect(PersonaStore.personas[0].visibility).toBe('public');
		});

		// When the REST API rejects the creation request (e.g. limit reached, duplicate tag, or validation failure),
		// createPersona extracts the specific human-readable error message provided in the API response JSON.
		it('throws an error with message from response body on failure', async () => {
			vi.mocked(http.post).mockResolvedValueOnce({
				ok: false,
				status: 400,
				body: {message: 'Persona limit reached'},
			} as any);

			await expect(PersonaCommands.createPersona({name: 'Over limit'})).rejects.toThrow('Persona limit reached');
		});

		// If the server returns a non-200 status without a valid error body (e.g. proxy gateway failure or 500 error),
		// it falls back to a standardized error string including the HTTP status code.
		it('throws fallback error message when response has no body', async () => {
			vi.mocked(http.post).mockResolvedValueOnce({
				ok: false,
				status: 500,
				body: null,
			} as any);

			await expect(PersonaCommands.createPersona({name: 'Server error'})).rejects.toThrow(
				'Failed to create persona: status 500',
			);
		});
	});

	describe('updatePersona', () => {
		it('updates persona via PATCH and updates store', async () => {
			// Seed store
			PersonaStore.upsertPersona({
				id: '1540000000000000001',
				name: 'Old Name',
				visibility: 'unlisted',
			} as any);

			const updatedResponse: PersonaResponse = {
				id: '1540000000000000001',
				name: 'New Name',
				avatar_url: null,
				system_name: null,
				pronouns: null,
				color: null,
				bio: null,
				auto_tag_disabled: false,
				persona_tags: [],
				use_count: 0,
				last_used_at_ms: null,
				visibility: 'private',
				external_uuid: null,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-02T00:00:00Z',
			};

			vi.mocked(http.patch).mockResolvedValueOnce({
				ok: true,
				status: 200,
				body: updatedResponse,
			} as any);

			const res = await PersonaCommands.updatePersona('1540000000000000001', {
				name: 'New Name',
				visibility: 'private',
			});

			expect(http.patch).toHaveBeenCalledWith(Endpoints.USER_PERSONA('1540000000000000001'), {
				body: {name: 'New Name', visibility: 'private'},
			});
			expect(res.name).toBe('New Name');
			expect(PersonaStore.personas[0].name).toBe('New Name');
			expect(PersonaStore.personas[0].visibility).toBe('private');
		});

		it('throws an error when update fails', async () => {
			vi.mocked(http.patch).mockResolvedValueOnce({
				ok: false,
				status: 400,
				body: {message: 'Duplicate tag'},
			} as any);

			await expect(PersonaCommands.updatePersona('1540000000000000001', {name: 'New Name'})).rejects.toThrow(
				'Duplicate tag',
			);
		});

		// Updating persona attributes (name, avatar, bio, tags) must invalidate the client-side
		// publicPersonaCache for this persona so that other users viewing profile popouts/cards
		// receive the fresh data on the next fetch rather than stale cached values.
		it('invalidates public persona cache when updating', async () => {
			const publicData: PublicPersonaResponse = {
				id: '1540000000000000001',
				name: 'Old Name',
				avatar_url: null,
				system_name: null,
				pronouns: null,
				color: null,
				bio: null,
				visibility: 'public',
			};
			vi.mocked(http.get).mockResolvedValueOnce({ok: true, status: 200, body: publicData} as any);
			await PersonaCommands.fetchPublicPersona('user_123', '1540000000000000001');

			vi.mocked(http.patch).mockResolvedValueOnce({
				ok: true,
				status: 200,
				body: {...publicData, name: 'New Name'},
			} as any);

			await PersonaCommands.updatePersona('1540000000000000001', {name: 'New Name'});

			vi.mocked(http.get).mockResolvedValueOnce({
				ok: true,
				status: 200,
				body: {...publicData, name: 'New Name'},
			} as any);
			await PersonaCommands.fetchPublicPersona('user_123', '1540000000000000001');
			expect(http.get).toHaveBeenCalledTimes(2);
		});
	});

	describe('deletePersona', () => {
		it('deletes persona via DELETE and removes from store', async () => {
			PersonaStore.upsertPersona({
				id: '1540000000000000001',
				name: 'Alice',
				visibility: 'unlisted',
			} as any);

			vi.mocked(http.delete).mockResolvedValueOnce({
				ok: true,
				status: 204,
				body: null,
			} as any);

			await PersonaCommands.deletePersona('1540000000000000001');
			expect(http.delete).toHaveBeenCalledWith(Endpoints.USER_PERSONA('1540000000000000001'));
			expect(PersonaStore.personas.length).toBe(0);
		});

		// Deletion is designed to be idempotent: if a persona was already deleted on the server
		// (e.g. concurrent deletion or out-of-order sync returning 404), the client should still
		// cleanly remove it from the local store and succeed without throwing an unhandled error.
		it('does not throw when delete returns 404 (already deleted)', async () => {
			PersonaStore.upsertPersona({
				id: '1540000000000000001',
				name: 'Alice',
				visibility: 'unlisted',
			} as any);

			vi.mocked(http.delete).mockResolvedValueOnce({
				ok: false,
				status: 404,
				body: null,
			} as any);

			await expect(PersonaCommands.deletePersona('1540000000000000001')).resolves.toBeUndefined();
			expect(PersonaStore.personas.length).toBe(0);
		});

		// Unexpected server errors (5xx/4xx other than 404) must reject with an error so that UI callers
		// can display an error toast or prompt the user.
		it('throws an error when delete fails with non-404 status', async () => {
			vi.mocked(http.delete).mockResolvedValueOnce({
				ok: false,
				status: 500,
				body: null,
			} as any);

			await expect(PersonaCommands.deletePersona('1540000000000000001')).rejects.toThrow(
				'Failed to delete persona: status 500',
			);
		});

		// Deleting a persona must evict its entry from publicPersonaCache so future lookups do not
		// serve stale data from memory.
		it('invalidates public persona cache when deleting', async () => {
			const publicData: PublicPersonaResponse = {
				id: '1540000000000000001',
				name: 'To Delete',
				avatar_url: null,
				system_name: null,
				pronouns: null,
				color: null,
				bio: null,
				visibility: 'public',
			};
			vi.mocked(http.get).mockResolvedValueOnce({ok: true, status: 200, body: publicData} as any);
			await PersonaCommands.fetchPublicPersona('user_123', '1540000000000000001');

			vi.mocked(http.delete).mockResolvedValueOnce({ok: true, status: 204, body: null} as any);
			await PersonaCommands.deletePersona('1540000000000000001');

			vi.mocked(http.get).mockResolvedValueOnce({ok: false, status: 404, body: null} as any);
			await PersonaCommands.fetchPublicPersona('user_123', '1540000000000000001');
			expect(http.get).toHaveBeenCalledTimes(2);
		});
	});

	describe('importPersonas', () => {
		it('imports personas by sending personas array directly in request body', async () => {
			const toImport: Array<PersonaCreateRequest> = [
				{
					name: 'Imported 1',
					visibility: 'unlisted',
				},
				{
					name: 'Imported 2',
					visibility: 'public',
				},
			];

			const importedResponses: Array<PersonaResponse> = [
				{
					id: '1540000000000000010',
					name: 'Imported 1',
					avatar_url: null,
					system_name: null,
					pronouns: null,
					color: null,
					bio: null,
					auto_tag_disabled: false,
					persona_tags: [],
					use_count: 0,
					last_used_at_ms: null,
					visibility: 'unlisted',
					external_uuid: null,
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-01T00:00:00Z',
				},
				{
					id: '1540000000000000011',
					name: 'Imported 2',
					avatar_url: null,
					system_name: null,
					pronouns: null,
					color: null,
					bio: null,
					auto_tag_disabled: false,
					persona_tags: [],
					use_count: 0,
					last_used_at_ms: null,
					visibility: 'public',
					external_uuid: null,
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-01T00:00:00Z',
				},
			];

			vi.mocked(http.post).mockResolvedValueOnce({
				ok: true,
				status: 200,
				body: importedResponses,
			} as any);

			const result = await PersonaCommands.importPersonas(toImport);

			expect(http.post).toHaveBeenCalledWith(Endpoints.USER_PERSONA_IMPORT, {
				body: toImport,
			});
			expect(result).toHaveLength(2);
			expect(PersonaStore.personas).toHaveLength(2);
			expect(PersonaStore.personas[0].name).toBe('Imported 1');
			expect(PersonaStore.personas[1].name).toBe('Imported 2');
		});

		it('throws an error when import request fails', async () => {
			vi.mocked(http.post).mockResolvedValueOnce({
				ok: false,
				status: 400,
				body: {message: 'Too many personas'},
			} as any);

			await expect(PersonaCommands.importPersonas([{name: 'Test'}])).rejects.toThrow('Too many personas');
		});
	});

	describe('fetchPublicPersona', () => {
		it('caches public persona responses to prevent redundant requests', async () => {
			const publicData: PublicPersonaResponse = {
				id: '1540000000000000099',
				name: 'Public Alice',
				avatar_url: null,
				system_name: 'Sys',
				pronouns: 'she/her',
				color: null,
				bio: 'Extended biography here',
				visibility: 'public',
			};

			vi.mocked(http.get).mockResolvedValueOnce({
				ok: true,
				status: 200,
				body: publicData,
			} as any);

			const res1 = await PersonaCommands.fetchPublicPersona('user_123', '1540000000000000099');
			expect(res1).toEqual(publicData);
			expect(http.get).toHaveBeenCalledTimes(1);

			// Second fetch should return cached response without second HTTP call
			const res2 = await PersonaCommands.fetchPublicPersona('user_123', '1540000000000000099');
			expect(res2).toEqual(publicData);
			expect(http.get).toHaveBeenCalledTimes(1);
		});

		// When a requested public persona does not exist or has private visibility, the API returns
		// a non-ok status (e.g. 404). fetchPublicPersona returns null so callers can gracefully
		// fall back to the account profile without error popups.
		it('returns null when http request returns not ok', async () => {
			vi.mocked(http.get).mockResolvedValueOnce({
				ok: false,
				status: 404,
				body: null,
			} as any);

			const res = await PersonaCommands.fetchPublicPersona('user_123', 'nonexistent');
			expect(res).toBeNull();
		});

		// Transient network exceptions or aborts should be caught and logged as warnings rather
		// than throwing uncaught errors into the UI render tree.
		it('returns null when http request throws an error', async () => {
			vi.mocked(http.get).mockRejectedValueOnce(new Error('Network error'));

			const res = await PersonaCommands.fetchPublicPersona('user_123', 'err-persona');
			expect(res).toBeNull();
		});
	});
});
