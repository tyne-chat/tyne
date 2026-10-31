// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/app/I18n', () => ({default: {_: (descriptor: {message?: string}) => descriptor.message ?? ''}}));
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
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
const {consumePersonaCommand, resolveExpressionPersona, resolveForwardPersona, resolveOutgoingPersona} = await import(
	'@app/features/persona/utils/OutgoingPersona'
);

describe('resolveOutgoingPersona', () => {
	let foxId: string;
	let baoId: string;

	beforeEach(async () => {
		PersonaStore.reset();
		foxId = addTestPersona(PersonaStore, {name: 'Fox'}).id;
		baoId = addTestPersona(PersonaStore, {name: 'Bao', persona_tags: [{prefix: 'B:', suffix: ''}]}).id;
	});

	afterEach(() => {
		PersonaStore.reset();
		vi.restoreAllMocks();
	});

	it('sends as the account when no tag matches and no persona is active', () => {
		expect(resolveOutgoingPersona(null, 'hello', false)).toEqual({content: 'hello', subprofile: undefined});
	});

	it('takes the tag out of the text and sends as the tagged persona', () => {
		const outgoing = resolveOutgoingPersona(null, 'B: bao', false);
		expect(outgoing.content).toBe('bao');
		expect(outgoing.subprofile).toMatchObject({id: baoId, name: 'Bao'});
	});

	it('sends as the active persona and leaves untagged text alone', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		const outgoing = resolveOutgoingPersona(null, 'bao', false);
		expect(outgoing.content).toBe('bao');
		expect(outgoing.subprofile).toMatchObject({id: foxId, name: 'Fox'});
	});

	it('prefers a tag over the active persona', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveOutgoingPersona(null, 'B: bao', false).subprofile).toMatchObject({id: baoId});
	});

	it('sends a backslash-escaped message as the account without the backslash', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveOutgoingPersona(null, '\\bao', false)).toEqual({content: 'bao', subprofile: undefined});
	});

	it('treats a tag on its own as a tag only when the message has other content', () => {
		expect(resolveOutgoingPersona(null, 'B:', false)).toEqual({content: 'B:', subprofile: undefined});
		const withMedia = resolveOutgoingPersona(null, 'B:', true, {allowEmptyContent: true});
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
		const fox = addTestPersona(PersonaStore, {name: 'Fox'});
		await PersonaStore.setActivePersona(fox.id, true);
		expect(consumePersonaCommand(null, '\\\\')).toBe(true);
		expect(PersonaStore.activePersona).toBeNull();
	});

	it('leaves everything else to be sent', async () => {
		expect(consumePersonaCommand(null, '\\\\')).toBe(false);
		const fox = addTestPersona(PersonaStore, {name: 'Fox'});
		await PersonaStore.setActivePersona(fox.id, true);
		expect(consumePersonaCommand(null, 'hello')).toBe(false);
		expect(PersonaStore.activePersona?.id).toBe(fox.id);
	});
});

describe('resolveForwardPersona', () => {
	const SOURCE = '1500000000000000001';
	const ROOM = '1500000000000000002';
	let foxId: string;
	let baoId: string;

	beforeEach(() => {
		PersonaStore.reset();
		foxId = addTestPersona(PersonaStore, {name: 'Fox'}).id;
		baoId = addTestPersona(PersonaStore, {name: 'Bao', persona_tags: [{prefix: 'B:', suffix: ''}]}).id;
	});

	afterEach(() => {
		PersonaStore.reset();
		vi.restoreAllMocks();
	});

	async function selectPerChannel(selections: Record<string, string>): Promise<void> {
		await PersonaStore.setActivePersonaScope('channel');
		for (const [channel_id, persona_id] of Object.entries(selections)) {
			PersonaStore.handleChannelStateUpdate({channel_id, persona_id});
		}
	}

	it('goes out as the account with nothing selected', () => {
		expect(resolveForwardPersona(SOURCE, ROOM, '')).toEqual({content: '', subprofile: undefined});
	});

	it('goes out as the selected persona, also with no comment', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveForwardPersona(SOURCE, ROOM, '').subprofile).toMatchObject({id: foxId, name: 'Fox'});
		expect(resolveForwardPersona(SOURCE, ROOM, 'look').subprofile).toMatchObject({id: foxId, name: 'Fox'});
	});

	it("prefers the source channel's selection over the destination's", async () => {
		await selectPerChannel({[SOURCE]: foxId, [ROOM]: baoId});
		expect(resolveForwardPersona(SOURCE, ROOM, '').subprofile?.id).toBe(foxId);
	});

	it("falls back to the destination's selection", async () => {
		await selectPerChannel({[ROOM]: baoId});
		expect(resolveForwardPersona(SOURCE, ROOM, '').subprofile?.id).toBe(baoId);
	});

	it('goes out as the account with no selection on either side', async () => {
		await selectPerChannel({'1500000000000000003': baoId});
		expect(resolveForwardPersona(SOURCE, ROOM, '').subprofile).toBeUndefined();
	});

	it('lets a tag in the comment decide for the forward and the comment', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		const outgoing = resolveForwardPersona(SOURCE, ROOM, 'B: look');
		expect(outgoing.content).toBe('look');
		expect(outgoing.subprofile?.id).toBe(baoId);
	});

	it('leaves nothing to send as a comment when the comment is only a tag', () => {
		const outgoing = resolveForwardPersona(SOURCE, ROOM, 'B:');
		expect(outgoing.content).toBe('');
		expect(outgoing.subprofile?.id).toBe(baoId);
	});

	it('goes out as the account when the comment escapes the selection', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		const outgoing = resolveForwardPersona(SOURCE, ROOM, '\\ look');
		expect(outgoing.content).toBe('look');
		expect(outgoing.subprofile).toBeUndefined();
	});

	it("escapes the destination's selection when it is the one that applies", async () => {
		await selectPerChannel({[ROOM]: baoId});
		const outgoing = resolveForwardPersona(SOURCE, ROOM, '\\ look');
		expect(outgoing.content).toBe('look');
		expect(outgoing.subprofile).toBeUndefined();
	});
});

describe('resolveExpressionPersona', () => {
	const ROOM = '1500000000000000001';
	const GIF = 'https://example.com/fox.gif';
	let foxId: string;
	let baoId: string;

	beforeEach(() => {
		PersonaStore.reset();
		foxId = addTestPersona(PersonaStore, {name: 'Fox'}).id;
		baoId = addTestPersona(PersonaStore, {name: 'Bao', persona_tags: [{prefix: 'B:', suffix: ''}]}).id;
	});

	afterEach(() => {
		PersonaStore.reset();
		vi.restoreAllMocks();
	});

	it('goes out as the selected persona with an empty draft', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveExpressionPersona(ROOM, '', GIF)?.id).toBe(foxId);
	});

	it('goes out as the persona a tag in the draft names', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveExpressionPersona(ROOM, 'B:', GIF)?.id).toBe(baoId);
	});

	it.each([['\\'], ['\\ text']])('goes out as the account with the draft %j, keeping the selection', async (draft) => {
		await PersonaStore.setActivePersona(foxId, true);
		expect(resolveExpressionPersona(ROOM, draft, GIF)).toBeNull();
		expect(PersonaStore.latchedPersonaFor(ROOM)?.id).toBe(foxId);
	});

	it('records one use, not one for the draft and one for the content', async () => {
		await PersonaStore.setActivePersona(foxId, true);
		const uses = PersonaStore.getPersona(foxId)?.use_count ?? 0;
		resolveExpressionPersona(ROOM, 'plain text', GIF);
		expect(PersonaStore.getPersona(foxId)?.use_count ?? 0).toBe(uses + 1);
	});

	it('goes out as the account with nothing selected', () => {
		expect(resolveExpressionPersona(ROOM, 'plain text', GIF)).toBeNull();
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
		const bao = addTestPersona(PersonaStore, {name: 'Bao', persona_tags: [{prefix: 'B:', suffix: ''}]});
		await PersonaStore.setActivePersonaMode('last');
		const usesBefore = PersonaStore.getPersona(bao.id)?.use_count ?? 0;
		expect(PersonaStore.previewOutgoingContent(null, 'B: bao')).toBe('bao');
		expect(PersonaStore.previewOutgoingContent(null, 'plain')).toBe('plain');
		expect(PersonaStore.getPersona(bao.id)?.use_count ?? 0).toBe(usesBefore);
		expect(PersonaStore.activePersonaId).toBeNull();
	});
});
