// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {reaction} from 'mobx';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {getSubPreference: () => undefined, setSubPreference: () => Promise.resolve(), isHydrated: true},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), configure: vi.fn()},
}));

installVoiceMenuTestBootstrap();

const PersonaCommands = await import('./PersonaCommands');
const {PersonaStore} = await import('../state/PersonaStore');
const {default: EmojiPins} = await import('@app/features/emoji/state/EmojiPins');

const persona = (
	id: string,
	name: string,
	visibility: PersonaResponse['visibility'] = 'unlisted',
): PersonaResponse => ({
	id,
	name,
	avatar_hash: null,
	banner_hash: null,
	pronouns: null,
	color: null,
	bio: null,
	auto_tag_disabled: false,
	persona_tags: [],
	signature_emojis: [],
	use_count: 0,
	last_used_at_ms: null,
	visibility,
	external_uuid: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
});

const A = '1540000000000000001';
const B = '1540000000000000002';
const C = '1540000000000000003';

// Many personas changed or deleted in one request (tyne-chat/tyne#542).
describe('bulk persona commands', () => {
	beforeEach(() => {
		PersonaStore.reset();
		EmojiPins.reset();
		vi.clearAllMocks();
		PersonaStore.setPersonas([persona(A, 'Alpha'), persona(B, 'Beta'), persona(C, 'Gamma', 'private')]);
	});

	describe('setPersonaVisibilities', () => {
		it('sends one request for every persona and takes the answer into the store', async () => {
			vi.mocked(http.patch).mockResolvedValueOnce({
				ok: true,
				status: 200,
				body: [persona(A, 'Alpha', 'public'), persona(B, 'Beta', 'public')],
			} as any);

			await PersonaCommands.setPersonaVisibilities([
				{id: A, visibility: 'public'},
				{id: B, visibility: 'public'},
			]);

			expect(http.patch).toHaveBeenCalledTimes(1);
			expect(http.patch).toHaveBeenCalledWith(ForkEndpoints.USER_PERSONA_VISIBILITY, {
				body: {
					personas: [
						{id: A, visibility: 'public'},
						{id: B, visibility: 'public'},
					],
				},
			});
			expect(PersonaStore.personas.map((p) => `${p.name}:${p.visibility}`)).toEqual([
				'Alpha:public',
				'Beta:public',
				'Gamma:private',
			]);
		});

		it('sends nothing for no change, and leaves the store alone when refused', async () => {
			await PersonaCommands.setPersonaVisibilities([]);
			expect(http.patch).not.toHaveBeenCalled();

			vi.mocked(http.patch).mockResolvedValueOnce({
				ok: false,
				status: 404,
				body: {code: 'UNKNOWN_PERSONA', message: 'Unknown persona'},
			} as any);
			await expect(PersonaCommands.setPersonaVisibilities([{id: A, visibility: 'public'}])).rejects.toBeInstanceOf(
				PersonaCommands.PersonaRequestError,
			);
			expect(PersonaStore.personas.find((p) => p.id === A)?.visibility).toBe('unlisted');
		});
	});

	describe('deletePersonas', () => {
		it('sends one request and drops the personas, with their pins in one change', async () => {
			EmojiPins.pinEmoji('unicode:fox', A);
			EmojiPins.pinEmoji('unicode:owl', B);
			vi.mocked(http.post).mockResolvedValueOnce({ok: true, status: 204, body: null} as any);
			const pinChanges = vi.fn();
			const stop = reaction(() => EmojiPins.personaPinnedEmojis, pinChanges);

			await PersonaCommands.deletePersonas([A, B]);
			stop();

			expect(http.post).toHaveBeenCalledTimes(1);
			expect(http.post).toHaveBeenCalledWith(ForkEndpoints.USER_PERSONA_BULK_DELETE, {body: {persona_ids: [A, B]}});
			expect(http.delete).not.toHaveBeenCalled();
			expect(PersonaStore.personas.map((p) => p.name)).toEqual(['Gamma']);
			expect(EmojiPins.getPersonaPinnedEmojiKeys(A)).toEqual([]);
			expect(pinChanges).toHaveBeenCalledTimes(1);
		});

		it('keeps every persona when the server refuses', async () => {
			vi.mocked(http.post).mockResolvedValueOnce({
				ok: false,
				status: 404,
				body: {code: 'UNKNOWN_PERSONA', message: 'Unknown persona'},
			} as any);

			await expect(PersonaCommands.deletePersonas([A, B])).rejects.toBeInstanceOf(PersonaCommands.PersonaRequestError);
			expect(PersonaStore.personas.map((p) => p.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
		});
	});
});
