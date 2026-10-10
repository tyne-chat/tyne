// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
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
	default: {getSubPreference: () => undefined, setSubPreference: () => Promise.resolve()},
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {
		get: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		post: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		patch: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		delete: vi.fn().mockResolvedValue({ok: true, status: 200, body: {}}),
		configure: vi.fn(),
	},
}));

installVoiceMenuTestBootstrap();

const {PersonaStore} = await import('@app/features/persona/state/PersonaStore');
const {consumePersonaCommand, resolveOutgoingPersona} = await import('@app/features/persona/utils/OutgoingPersona');

describe('resolveOutgoingPersona', () => {
	let foxId: string;
	let baoId: string;

	beforeEach(async () => {
		PersonaStore.reset();
		foxId = (await PersonaStore.addPersona({name: 'Fox'})).id;
		baoId = (await PersonaStore.addPersona({name: 'Bao', persona_tags: [{prefix: 'B:', suffix: ''}]})).id;
	});

	afterEach(() => {
		PersonaStore.reset();
		vi.restoreAllMocks();
	});

	it('sends as the account when no tag matches and no persona is active', () => {
		expect(resolveOutgoingPersona('hello', false)).toEqual({content: 'hello', subprofile: undefined});
	});

	it('takes the tag out of the text and sends as the tagged persona', () => {
		const outgoing = resolveOutgoingPersona('B: bao', false);
		expect(outgoing.content).toBe('bao');
		expect(outgoing.subprofile).toMatchObject({id: baoId, name: 'Bao'});
	});

	it('sends as the active persona and leaves untagged text alone', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		const outgoing = resolveOutgoingPersona('bao', false);
		expect(outgoing.content).toBe('bao');
		expect(outgoing.subprofile).toMatchObject({id: foxId, name: 'Fox'});
	});

	it('prefers a tag over the active persona', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveOutgoingPersona('B: bao', false).subprofile).toMatchObject({id: baoId});
	});

	it('sends a backslash-escaped message as the account without the backslash', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveOutgoingPersona('\\bao', false)).toEqual({content: 'bao', subprofile: undefined});
	});

	it('treats a tag on its own as a tag only when the message has other content', () => {
		expect(resolveOutgoingPersona('B:', false)).toEqual({content: 'B:', subprofile: undefined});
		const withMedia = resolveOutgoingPersona('B:', true, {allowEmptyContent: true});
		expect(withMedia.content).toBe('');
		expect(withMedia.subprofile).toMatchObject({id: baoId});
	});
});

describe('consumePersonaCommand', () => {
	beforeEach(() => {
		PersonaStore.reset();
	});

	afterEach(() => {
		PersonaStore.reset();
		vi.restoreAllMocks();
	});

	it('consumes a lone double backslash and clears the active persona', async () => {
		const fox = await PersonaStore.addPersona({name: 'Fox'});
		await PersonaStore.setActivePersona(fox.id, true);
		expect(consumePersonaCommand('\\\\')).toBe(true);
		expect(PersonaStore.activePersona).toBeNull();
	});

	it('leaves everything else to be sent', async () => {
		expect(consumePersonaCommand('\\\\')).toBe(false);
		const fox = await PersonaStore.addPersona({name: 'Fox'});
		await PersonaStore.setActivePersona(fox.id, true);
		expect(consumePersonaCommand('hello')).toBe(false);
		expect(PersonaStore.activePersona?.id).toBe(fox.id);
	});
});

describe('PersonaStore.previewOutgoingContent', () => {
	beforeEach(() => {
		PersonaStore.reset();
	});

	afterEach(() => {
		PersonaStore.reset();
		vi.restoreAllMocks();
	});

	it('gives the text without its tag and records nothing', async () => {
		const bao = await PersonaStore.addPersona({name: 'Bao', persona_tags: [{prefix: 'B:', suffix: ''}]});
		await PersonaStore.setActivePersonaMode('last');
		const usesBefore = PersonaStore.getPersona(bao.id)?.use_count ?? 0;
		expect(PersonaStore.previewOutgoingContent('B: bao')).toBe('bao');
		expect(PersonaStore.previewOutgoingContent('plain')).toBe('plain');
		expect(PersonaStore.getPersona(bao.id)?.use_count ?? 0).toBe(usesBefore);
		expect(PersonaStore.activePersonaId).toBeNull();
	});
});
