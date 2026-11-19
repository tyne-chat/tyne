// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (d: {message?: string}) => d.message ?? '', locale: 'en'}}),
}));
vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	setPersonaMentionableBy: vi.fn().mockResolvedValue([]),
}));
vi.mock('@app/features/ui/commands/ToastCommands', () => ({createToast: vi.fn()}));

import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import type {I18n} from '@lingui/core';
import {act, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {applyMentionableBy} from './PersonaBulkMentionActions';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The selection's "Allow mentions by" (tyne-chat/tyne#652): one request, Undo putting back what was
// stored (null included), and a selection that stays when nothing changes or the request fails.

const i18n = {_: (d: {message?: string}) => d.message ?? ''} as unknown as I18n;
const persona = (id: string, mentionable_by: ClientPersona['mentionable_by']) =>
	({id, name: `P${id}`, visibility: 'unlisted', mentionable_by}) as ClientPersona;

describe('changing who gets the selected personas in mention suggestions', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.clearAllMocks();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it('sends one request for the personas that change, and Undo restores each stored value', async () => {
		const onDone = vi.fn();
		await applyMentionableBy(
			i18n,
			[persona('1', null), persona('2', 'self'), persona('3', 'nobody')],
			'nobody',
			onDone,
		);

		expect(PersonaCommands.setPersonaMentionableBy).toHaveBeenCalledTimes(1);
		expect(PersonaCommands.setPersonaMentionableBy).toHaveBeenCalledWith([
			{id: '1', mentionable_by: 'nobody'},
			{id: '2', mentionable_by: 'nobody'},
		]);
		expect(onDone).toHaveBeenCalledTimes(1);

		const toast = vi.mocked(ToastCommands.createToast).mock.calls[0]![0] as {children: ReactNode};
		await act(async () => {
			root.render(toast.children);
		});
		await act(async () => {
			(container.querySelector('[data-flx="persona.bulk.mentions-undo"]') as HTMLButtonElement).click();
		});
		expect(PersonaCommands.setPersonaMentionableBy).toHaveBeenLastCalledWith([
			{id: '1', mentionable_by: null},
			{id: '2', mentionable_by: 'self'},
		]);
	});

	it('sends nothing and keeps the selection when every persona has the value already', async () => {
		const onDone = vi.fn();
		await applyMentionableBy(i18n, [persona('1', null), persona('2', undefined)], null, onDone);

		expect(PersonaCommands.setPersonaMentionableBy).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
	});

	it('keeps the selection and reports a failure, without trying again', async () => {
		vi.mocked(PersonaCommands.setPersonaMentionableBy).mockRejectedValueOnce(new Error('offline'));
		const onDone = vi.fn();
		await applyMentionableBy(i18n, [persona('1', null)], 'everyone', onDone);

		expect(PersonaCommands.setPersonaMentionableBy).toHaveBeenCalledTimes(1);
		expect(onDone).not.toHaveBeenCalled();
		expect(ToastCommands.createToast).toHaveBeenCalledWith(expect.objectContaining({type: 'error'}));
	});
});
