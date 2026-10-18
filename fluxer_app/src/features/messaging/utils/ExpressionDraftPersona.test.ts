// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: () => null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

const http = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
	configure: vi.fn(),
}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({http}));

installVoiceMenuTestBootstrap();

const {PersonaStoreClass} = await import('@app/features/persona/state/PersonaStore');
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
const {clearComposerAfterExpression, isDraftUsedUpByExpression} = await import('./ExpressionDraftPersona');
type PersonaStoreInstance = InstanceType<typeof PersonaStoreClass>;

const CHANNEL = 'one';

describe('isDraftUsedUpByExpression (tyne-chat/tyne#122)', () => {
	let store: PersonaStoreInstance;
	let alice: string;

	beforeEach(() => {
		for (const mock of [http.get, http.post, http.patch, http.put, http.delete]) {
			mock.mockReset();
			mock.mockResolvedValue({ok: true, status: 200, body: {}});
		}
		store = new PersonaStoreClass();
		alice = addTestPersona(store, {name: 'Alice', persona_tags: [{prefix: 'a:'}]}).id;
	});

	it('keeps ordinary text', () => {
		expect(isDraftUsedUpByExpression(CHANNEL, 'hello there', store)).toBe(false);
	});

	it('keeps ordinary text while a persona is selected', async () => {
		await store.setActivePersona(alice, true);
		expect(isDraftUsedUpByExpression(CHANNEL, 'hello there', store)).toBe(false);
	});

	it('keeps text that follows a tag', () => {
		expect(isDraftUsedUpByExpression(CHANNEL, 'a: hello there', store)).toBe(false);
	});

	it('uses up a tag typed on its own', () => {
		expect(isDraftUsedUpByExpression(CHANNEL, 'a:', store)).toBe(true);
		expect(isDraftUsedUpByExpression(CHANNEL, 'a: ', store)).toBe(true);
	});

	it('uses up an escape typed on its own while a persona is selected', async () => {
		await store.setActivePersona(alice, true);
		expect(isDraftUsedUpByExpression(CHANNEL, '\\', store)).toBe(true);
		expect(isDraftUsedUpByExpression(CHANNEL, '\\\\', store)).toBe(true);
	});

	it('keeps a backslash as text when no persona is selected', () => {
		expect(isDraftUsedUpByExpression(CHANNEL, '\\', store)).toBe(false);
	});

	it('leaves an empty or blank composer alone', () => {
		expect(isDraftUsedUpByExpression(CHANNEL, '', store)).toBe(false);
		expect(isDraftUsedUpByExpression(CHANNEL, '   ', store)).toBe(false);
	});
});

describe('clearComposerAfterExpression', () => {
	it('does nothing when the text was not used up', () => {
		const clear = vi.fn();
		const setValue = vi.fn();
		clearComposerAfterExpression(false, clear, setValue);
		expect(clear).not.toHaveBeenCalled();
		expect(setValue).not.toHaveBeenCalled();
	});

	it('clears the composer when the text was used up', () => {
		const clear = vi.fn();
		const setValue = vi.fn();
		clearComposerAfterExpression(true, clear, setValue);
		expect(clear).toHaveBeenCalledTimes(1);
		expect(setValue).not.toHaveBeenCalled();
	});

	it('empties the value when there is no composer to clear', () => {
		const setValue = vi.fn();
		clearComposerAfterExpression(true, undefined, setValue);
		expect(setValue).toHaveBeenCalledWith('');
	});
});
