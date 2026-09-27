// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

import {runInAction} from 'mobx';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== 'undefined' && (window as any).Animation) {
	(window as any).Animation.prototype.cancel = () => {};
}

vi.mock('framer-motion', async () => {
	const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
	return {
		...actual,
		motion: {
			div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
				<div ref={ref} data-flx="persona.plural-kit-import-modal-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="persona.plural-kit-import-modal-test.span" {...props} />
			)),
		},
		AnimatePresence: ({children}: {children?: React.ReactNode}) => <>{children}</>,
	};
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) => {
				let msg = descriptor?.message ?? '';
				if (values) {
					for (const [k, v] of Object.entries(values)) {
						msg = msg.replaceAll(`{${k}}`, String(v));
					}
				}
				return msg;
			},
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	importPersonas: vi.fn().mockResolvedValue(undefined),
	deletePersona: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/features/ui/commands/ToastCommands', () => ({
	createToast: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: vi.fn((m) => (typeof m === 'function' ? m() : m)),
	modal: vi.fn((fn) => fn),
}));

import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {PluralKitImportModal} from '@app/features/persona/components/modals/PluralKitImportModal';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';

describe('PluralKitImportModal Component', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
		runInAction(() => {
			PersonaStore.reset();
		});
		PersonaStore.setDisplayTag = vi.fn().mockResolvedValue(undefined) as any;
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = '';
	});

	it('renders initial file selection state', async () => {
		const onClose = vi.fn();

		await act(async () => {
			root.render(
				<PluralKitImportModal
					onClose={onClose}
					data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal"
				/>,
			);
		});

		expect(document.body.textContent).toContain('Import from PluralKit');
		expect(document.body.textContent).toContain('Choose a PluralKit export (.json) or drag & drop');
	});

	it('shows error if uploaded file does not contain members array', async () => {
		const onClose = vi.fn();

		await act(async () => {
			root.render(
				<PluralKitImportModal
					onClose={onClose}
					data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--2"
				/>,
			);
		});

		const fileInput = document.body.querySelector('input[type="file"]') as HTMLInputElement;
		expect(fileInput).not.toBeNull();

		const invalidJson = JSON.stringify({id: 'sys123', name: 'System Without Members'});
		const file = new File([invalidJson], 'pluralkit_invalid.json', {type: 'application/json'});

		const originalFileReader = window.FileReader;
		try {
			window.FileReader = class MockFileReader {
				onload: ((e: any) => void) | null = null;
				onerror: (() => void) | null = null;
				readAsText() {
					setTimeout(() => {
						this.onload?.({target: {result: invalidJson}});
					}, 0);
				}
			} as any;

			await act(async () => {
				Object.defineProperty(fileInput, 'files', {value: [file]});
				fileInput.dispatchEvent(new Event('change', {bubbles: true}));
				await new Promise((r) => setTimeout(r, 10));
			});

			expect(document.body.textContent).toContain('No "members" array found in this export file.');
		} finally {
			window.FileReader = originalFileReader;
		}
	});

	it('parses valid PK export file, displays preview, and executes import', async () => {
		const onClose = vi.fn();

		await act(async () => {
			root.render(
				<PluralKitImportModal
					onClose={onClose}
					data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--3"
				/>,
			);
		});

		const validExport = JSON.stringify({
			name: 'Solar System',
			tag: 'SOLAR',
			members: [
				{
					id: 'm1',
					name: 'Sun',
					pronouns: 'it/its',
					color: '#ffaa00',
					description: 'Star of the system',
					proxy_tags: [{prefix: '[', suffix: ']'}],
				},
				{
					id: 'm2',
					name: 'Earth',
					pronouns: 'she/her',
					color: '#0088ff',
					description: 'Third planet',
					proxy_tags: [{prefix: 'E:', suffix: ''}],
				},
			],
		});

		const file = new File([validExport], 'pluralkit_export.json', {type: 'application/json'});
		const fileInput = document.body.querySelector('input[type="file"]') as HTMLInputElement;

		const originalFileReader = window.FileReader;
		try {
			window.FileReader = class MockFileReader {
				onload: ((e: any) => void) | null = null;
				onerror: (() => void) | null = null;
				readAsText() {
					setTimeout(() => {
						this.onload?.({target: {result: validExport}});
					}, 0);
				}
			} as any;

			await act(async () => {
				Object.defineProperty(fileInput, 'files', {value: [file]});
				fileInput.dispatchEvent(new Event('change', {bubbles: true}));
				await new Promise((r) => setTimeout(r, 10));
			});

			// Should show file details and parsed members
			expect(document.body.textContent).toContain('pluralkit_export.json');
			expect(document.body.textContent).toContain('Total Members2');
			expect(document.body.textContent).toContain('Solar System (SOLAR)');

			// Find start import button
			const importBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
				btn.textContent?.includes('Start Import'),
			);
			expect(importBtn).toBeDefined();

			await act(async () => {
				importBtn?.click();
				await new Promise((r) => setTimeout(r, 20));
			});

			expect(PersonaCommands.importPersonas).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'Sun',
						pronouns: 'it/its',
						color: 0xffaa00,
						bio: 'Star of the system',
						persona_tags: [{prefix: '[', suffix: ']'}],
					}),
					expect.objectContaining({
						name: 'Earth',
						pronouns: 'she/her',
						color: 0x0088ff,
						bio: 'Third planet',
						persona_tags: [{prefix: 'E:', suffix: undefined}],
					}),
				]),
			);

			// Completed view
			expect(document.body.textContent).toContain('Import Complete!');
			expect(document.body.textContent).toContain('Successfully imported 2 persona(s)');
		} finally {
			window.FileReader = originalFileReader;
		}
	});

	it('prompts confirmation when using replace mode with existing personas', async () => {
		const onClose = vi.fn();

		runInAction(() => {
			PersonaStore.setPersonas([{id: '100000000000000001', name: 'Existing Persona 1'} as any]);
		});

		await act(async () => {
			root.render(
				<PluralKitImportModal
					onClose={onClose}
					data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--4"
				/>,
			);
		});

		const validExport = JSON.stringify({
			name: 'Test System',
			members: [
				{
					id: 'm1',
					name: 'New Member',
				},
			],
		});

		const file = new File([validExport], 'pluralkit.json', {type: 'application/json'});
		const fileInput = document.body.querySelector('input[type="file"]') as HTMLInputElement;

		const originalFileReader = window.FileReader;
		try {
			window.FileReader = class MockFileReader {
				onload: ((e: any) => void) | null = null;
				readAsText() {
					setTimeout(() => {
						this.onload?.({target: {result: validExport}});
					}, 0);
				}
			} as any;

			await act(async () => {
				Object.defineProperty(fileInput, 'files', {value: [file]});
				fileInput.dispatchEvent(new Event('change', {bubbles: true}));
				await new Promise((r) => setTimeout(r, 10));
			});

			// Select "Replace existing personas" radio (the second radio option)
			const radios = document.body.querySelectorAll('input[type="radio"]');
			expect(radios.length).toBe(2);
			const replaceRadio = radios[1] as HTMLInputElement;

			await act(async () => {
				replaceRadio.click();
			});

			const importBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
				btn.textContent?.includes('Start Import'),
			);
			expect(importBtn).toBeDefined();

			await act(async () => {
				importBtn?.click();
			});

			// Should prompt ConfirmModal
			expect(ModalCommands.push).toHaveBeenCalledTimes(1);
		} finally {
			window.FileReader = originalFileReader;
		}
	});
});
