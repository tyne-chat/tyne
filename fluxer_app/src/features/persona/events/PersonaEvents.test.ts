// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
	handleUserPersonaCreate,
	handleUserPersonaDelete,
	handleUserPersonasUpdate,
	handleUserPersonaUpdate,
} from './PersonaEvents';

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

const {PersonaStore} = await import('../state/PersonaStore');

const mockContext = {} as GatewayHandlerContext;

const samplePersona: PersonaResponse = {
	id: '1540000000000000001',
	name: 'Gateway Persona 1',
	avatar_url: 'https://cdn.example.com/p1.png',
	system_name: 'Sys 1',
	pronouns: 'they/them',
	color: 0x112233,
	bio: 'Created via gateway',
	auto_tag_disabled: false,
	persona_tags: [{prefix: 'g1:', suffix: ''}],
	use_count: 5,
	last_used_at_ms: null,
	visibility: 'unlisted',
	external_uuid: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

const samplePersona2: PersonaResponse = {
	id: '1540000000000000002',
	name: 'Gateway Persona 2',
	avatar_url: null,
	system_name: null,
	pronouns: 'she/her',
	color: null,
	bio: null,
	auto_tag_disabled: true,
	persona_tags: [],
	use_count: 0,
	last_used_at_ms: null,
	visibility: 'public',
	external_uuid: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

// Tests for real-time WebSocket Gateway event handlers that keep the client-side
// PersonaStore in sync when personas are modified on other tabs, mobile clients, or via API.
describe('PersonaEvents', () => {
	beforeEach(() => {
		PersonaStore.clear();
		vi.clearAllMocks();
	});

	// Verifies that a USER_PERSONA_CREATE gateway dispatch pushes the new persona into
	// PersonaStore so it immediately becomes selectable in the picker without reloading.
	it('handles USER_PERSONA_CREATE by upserting persona into store', () => {
		expect(PersonaStore.personas.find((p) => p.id === samplePersona.id)).toBeUndefined();

		handleUserPersonaCreate(samplePersona, mockContext);

		const stored = PersonaStore.personas.find((p) => p.id === samplePersona.id);
		expect(stored).toBeDefined();
		expect(stored?.name).toBe('Gateway Persona 1');
		expect(stored?.systemName).toBe('Sys 1');
	});

	// Verifies that a USER_PERSONA_UPDATE gateway dispatch updates the persona in-place
	// in PersonaStore, updating active UI components reactively.
	it('handles USER_PERSONA_UPDATE by updating existing persona in store', () => {
		handleUserPersonaCreate(samplePersona, mockContext);

		const updatedPersona: PersonaResponse = {
			...samplePersona,
			name: 'Updated Gateway Persona',
			bio: 'Updated bio',
		};

		handleUserPersonaUpdate(updatedPersona, mockContext);

		const stored = PersonaStore.personas.find((p) => p.id === samplePersona.id);
		expect(stored?.name).toBe('Updated Gateway Persona');
		expect(stored?.bio).toBe('Updated bio');
	});

	// Verifies that a USER_PERSONA_DELETE gateway dispatch removes the persona and unlatches
	// it if it was currently selected.
	it('handles USER_PERSONA_DELETE by removing persona from store', () => {
		handleUserPersonaCreate(samplePersona, mockContext);
		expect(PersonaStore.personas.find((p) => p.id === samplePersona.id)).toBeDefined();

		handleUserPersonaDelete({id: samplePersona.id}, mockContext);

		expect(PersonaStore.personas.find((p) => p.id === samplePersona.id)).toBeUndefined();
	});

	// Verifies that a USER_PERSONAS_UPDATE gateway dispatch (sent after bulk import or mass sync)
	// atomically replaces the entire personas array in PersonaStore.
	it('handles USER_PERSONAS_UPDATE by setting the entire list of personas', () => {
		handleUserPersonaCreate(samplePersona, mockContext);
		expect(PersonaStore.personas).toHaveLength(1);

		handleUserPersonasUpdate([samplePersona, samplePersona2], mockContext);

		expect(PersonaStore.personas).toHaveLength(2);
		expect(PersonaStore.personas.find((p) => p.id === samplePersona.id)?.name).toBe('Gateway Persona 1');
		expect(PersonaStore.personas.find((p) => p.id === samplePersona2.id)?.name).toBe('Gateway Persona 2');
	});
});
