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
	setPersonaVisibilities: vi.fn().mockResolvedValue([]),
	deletePersonas: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({push: vi.fn(), modal: vi.fn((fn) => fn), pop: vi.fn()}));
vi.mock('@app/features/ui/commands/ToastCommands', () => ({createToast: vi.fn()}));

import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import type {ClientPersona} from '@app/features/persona/state/PersonaStore';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import type {I18n} from '@lingui/core';
import {act, type ReactElement, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {
	type PersonaSelection,
	PersonaVisibilityChips,
	requestDelete,
	requestVisibility,
	usePersonaSelection,
} from './PersonaBulkSelection';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = {_: (d: {message?: string}) => d.message ?? ''} as unknown as I18n;
const persona = (id: string, visibility: ClientPersona['visibility']) =>
	({id, name: `P${id}`, visibility}) as ClientPersona;
const A = persona('1', 'unlisted');
const B = persona('2', 'unlisted');
const C = persona('3', 'public');

/** Runs the primary action of the confirmation the last push opened. */
async function confirmLastModal(): Promise<void> {
	const open = vi.mocked(ModalCommands.push).mock.calls.at(-1)![0] as unknown as () => ReactElement<{
		onPrimary: () => Promise<void> | void;
	}>;
	await act(async () => {
		await open().props.onPrimary();
	});
}

describe('selecting many personas (tyne-chat/tyne#542)', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.clearAllMocks();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it('makes personas unlisted at once, then Undo puts each back in one request', async () => {
		const onDone = vi.fn();
		const mixed = [persona('4', 'public'), persona('5', 'private'), persona('6', 'unlisted')];

		await act(async () => requestVisibility(i18n, mixed, 'unlisted', onDone));

		expect(ModalCommands.push).not.toHaveBeenCalled();
		expect(PersonaCommands.setPersonaVisibilities).toHaveBeenCalledTimes(1);
		expect(PersonaCommands.setPersonaVisibilities).toHaveBeenCalledWith([
			{id: '4', visibility: 'unlisted'},
			{id: '5', visibility: 'unlisted'},
		]);
		expect(onDone).toHaveBeenCalledTimes(1);

		const toast = vi.mocked(ToastCommands.createToast).mock.calls[0]![0];
		expect(toast.type).toBe('success');
		await act(async () => root.render(toast.children as ReactNode));
		await act(async () => (container.querySelector('[data-flx="persona.bulk.undo"]') as HTMLElement).click());
		expect(PersonaCommands.setPersonaVisibilities).toHaveBeenCalledTimes(2);
		expect(PersonaCommands.setPersonaVisibilities).toHaveBeenLastCalledWith([
			{id: '4', visibility: 'public'},
			{id: '5', visibility: 'private'},
		]);
	});

	it('asks before making personas public, and sends only after the confirmation', async () => {
		const onDone = vi.fn();
		requestVisibility(i18n, [A, B, C], 'public', onDone);

		expect(ModalCommands.push).toHaveBeenCalledTimes(1);
		expect(PersonaCommands.setPersonaVisibilities).not.toHaveBeenCalled();
		await confirmLastModal();
		expect(PersonaCommands.setPersonaVisibilities).toHaveBeenCalledWith([
			{id: '1', visibility: 'public'},
			{id: '2', visibility: 'public'},
		]);
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it('asks before making personas private too', () => {
		requestVisibility(i18n, [A], 'private', vi.fn());
		expect(ModalCommands.push).toHaveBeenCalledTimes(1);
	});

	it('keeps the selection and says so when the change fails', async () => {
		vi.mocked(PersonaCommands.setPersonaVisibilities).mockRejectedValueOnce(new Error('429'));
		const onDone = vi.fn();

		await act(async () => requestVisibility(i18n, [C], 'unlisted', onDone));
		expect(vi.mocked(ToastCommands.createToast).mock.calls[0]![0].type).toBe('error');
		expect(onDone).not.toHaveBeenCalled();

		await act(async () => requestVisibility(i18n, [A], 'unlisted', onDone));
		expect(PersonaCommands.setPersonaVisibilities).toHaveBeenCalledTimes(1);
	});

	it('deletes after a red confirmation, in one request, with no Undo', async () => {
		const onDone = vi.fn();
		requestDelete(i18n, [A, C], onDone);

		const open = vi.mocked(ModalCommands.push).mock.calls[0]![0] as unknown as () => ReactElement<{
			primaryVariant?: string;
		}>;
		expect(open().props.primaryVariant).toBe('danger');
		expect(PersonaCommands.deletePersonas).not.toHaveBeenCalled();
		await confirmLastModal();
		expect(PersonaCommands.deletePersonas).toHaveBeenCalledWith(['1', '3']);
		expect(onDone).toHaveBeenCalledTimes(1);
		const toast = vi.mocked(ToastCommands.createToast).mock.calls[0]![0];
		expect(typeof toast.children).toBe('string');
	});

	it('selects all shown personas, or clears them when all are selected, and drops deleted ones', async () => {
		let selection: PersonaSelection | null = null;
		const Probe = ({personas}: {personas: Array<ClientPersona>}) => {
			selection = usePersonaSelection(personas);
			return null;
		};
		await act(async () => root.render(<Probe personas={[A, B, C]} data-flx="persona.bulk-test.probe" />));

		await act(async () => selection!.start([C.id]));
		await act(async () => selection!.toggleAll([A.id, B.id]));
		expect(Array.from(selection!.selected).sort()).toEqual(['1', '2', '3']);
		await act(async () => selection!.toggleAll([A.id, B.id]));
		expect(Array.from(selection!.selected)).toEqual(['3']);

		await act(async () => root.render(<Probe personas={[A, B]} data-flx="persona.bulk-test.probe" />));
		expect(selection!.selected.size).toBe(0);
	});

	it('counts each visibility on its chip', async () => {
		await act(async () =>
			root.render(
				<PersonaVisibilityChips
					personas={[A, B, C]}
					value="all"
					onChange={vi.fn()}
					data-flx="persona.bulk-test.chips"
				/>,
			),
		);
		const counts = Array.from(container.querySelectorAll('[data-flx="persona.bulk.chip"]')).map((el) => el.textContent);
		expect(counts).toEqual(['All3', 'Public1', 'Unlisted2', 'Private0']);
	});
});
