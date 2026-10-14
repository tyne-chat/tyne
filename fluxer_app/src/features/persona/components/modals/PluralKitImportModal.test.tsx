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

// Waits for work the modal does in the background (reading the file, running the import)
// by checking for its result, however long the machine takes. A fixed pause is too short
// on a slow one.
async function settled(check: () => void): Promise<void> {
	await act(async () => {
		await vi.waitFor(check, {timeout: 10_000, interval: 5});
	});
}

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
	importPersonaImage: vi.fn(async (kind: string) => ({
		hash: kind === 'avatar' ? 'aaaaaaaa' : 'bbbbbbbb',
		avatarColor: 7,
	})),
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
import {zipSync} from 'fflate';

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
		expect(document.body.textContent).toContain(
			'Choose a PluralKit export (.json) or a Tyne export (.zip), or drag & drop',
		);
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
			});
			await settled(() => expect(document.body.textContent).toContain('No "members" array found in this export file.'));

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
			});
			await settled(() => expect(document.body.textContent).toContain('Total Members2'));

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
			});
			await settled(() => expect(document.body.textContent).toContain('Import Complete!'));

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
			});
			await settled(() => expect(document.body.querySelectorAll('input[type="radio"]').length).toBe(2));

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
	// Picks a file in the dialog and waits for the summary.
	async function chooseFile(file: File, summaryText: string): Promise<void> {
		const fileInput = document.body.querySelector('input[type="file"]') as HTMLInputElement;
		await act(async () => {
			Object.defineProperty(fileInput, 'files', {value: [file], configurable: true});
			fileInput.dispatchEvent(new Event('change', {bubbles: true}));
		});
		await settled(() => expect(document.body.textContent).toContain(summaryText));
	}

	async function startImport(): Promise<void> {
		const importBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
			btn.textContent?.includes('Start Import'),
		);
		await act(async () => {
			importBtn?.click();
		});
		await settled(() => expect(document.body.textContent).toContain('Import Complete!'));
	}

	const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
	const PUBLIC = {
		visibility: 'public',
		name_privacy: 'public',
		description_privacy: 'public',
		banner_privacy: 'public',
		birthday_privacy: 'public',
		pronoun_privacy: 'public',
		avatar_privacy: 'public',
		metadata_privacy: 'public',
		proxy_privacy: 'public',
	};

	it('follows PluralKit privacy, prefers the proxy avatar, and fetches banners', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			const body = JSON.parse(String(init?.body)) as {urls: Array<string>; kind: string};
			const results = Object.fromEntries(
				body.urls.map((url) => [url, body.kind === 'banner' ? {banner_hash: 'cccccccc'} : {avatar_hash: 'dddddddd'}]),
			);
			return new Response(`${JSON.stringify({type: 'complete', total: body.urls.length, results})}\n`, {
				status: 200,
			});
		});
		try {
			await act(async () => {
				root.render(
					<PluralKitImportModal
						onClose={vi.fn()}
						data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--5"
					/>,
				);
			});
			const file = JSON.stringify({
				tag: 'SYS',
				members: [
					{
						id: 'aaaaa',
						name: 'Open',
						avatar_url: 'https://cdn.example/main.png',
						webhook_avatar_url: 'https://cdn.example/proxy.png',
						banner: 'https://cdn.example/banner.png',
						privacy: PUBLIC,
					},
					{id: 'bbbbb', name: 'Hidden', privacy: {...PUBLIC, visibility: 'private'}},
					{id: 'ccccc', name: 'Closed', privacy: {...PUBLIC, description_privacy: 'private'}},
				],
			});
			await chooseFile(new File([file], 'pk.json', {type: 'application/json'}), 'Total Members3');
			expect(document.body.textContent).toContain('1 public, 1 unlisted, 1 private');

			await startImport();

			const requested = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
			expect(requested).toEqual([
				{urls: ['https://cdn.example/proxy.png'], kind: 'avatar'},
				{urls: ['https://cdn.example/banner.png'], kind: 'banner'},
			]);
			expect(PersonaCommands.importPersonas).toHaveBeenCalledWith([
				expect.objectContaining({
					name: 'Open',
					visibility: 'public',
					avatar_hash: 'dddddddd',
					banner_hash: 'cccccccc',
					external_uuid: 'aaaaa',
					image_sources: {
						avatar: {url: 'https://cdn.example/proxy.png', field: 'webhook_avatar_url', main_avatar_empty: false},
						banner: {url: 'https://cdn.example/banner.png'},
					},
				}),
				expect.objectContaining({name: 'Hidden', visibility: 'unlisted'}),
				expect.objectContaining({name: 'Closed', visibility: 'private'}),
			]);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('imports a Tyne export zip with its images, full bio and tag, without downloading anything', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		try {
			await act(async () => {
				root.render(
					<PluralKitImportModal
						onClose={vi.fn()}
						data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--6"
					/>,
				);
			});
			const encoder = new TextEncoder();
			const pluralKit = {
				version: 2,
				tag: `${'T'.repeat(78)}…`,
				members: [
					{
						id: '1428573920012345678',
						name: 'Alvis',
						color: null,
						pronouns: null,
						avatar_url: 'https://media.example/avatars/1/abcdef12.png',
						webhook_avatar_url: null,
						banner: null,
						description: 'short…',
						proxy_tags: [{prefix: 'v:', suffix: null}],
						privacy: PUBLIC,
					},
				],
				groups: [],
				switches: [],
			};
			const manifest = {
				format: 'tyne-personas',
				version: 1,
				pluralkit_file: 'pluralkit.json',
				tag_text: 'T'.repeat(90),
				members: {
					'1428573920012345678': {
						avatar: 'avatars/Alvis.png',
						bio: 'the whole bio',
						auto_tag_disabled: true,
						signature_emojis: [{name: '🌸'}],
					},
				},
			};
			const zip = zipSync({
				'pluralkit.json': encoder.encode(JSON.stringify(pluralKit)),
				'tyne.json': encoder.encode(JSON.stringify(manifest)),
				'avatars/Alvis.png': PNG,
				'README.txt': encoder.encode('read me'),
			});
			await chooseFile(new File([zip as BlobPart], 'Tyne personas.zip', {type: 'application/zip'}), 'Total Members1');
			const tagInput = Array.from(document.body.querySelectorAll('input[type="text"]')).at(-1) as HTMLInputElement;
			expect(tagInput.value).toBe('T'.repeat(90));

			await startImport();

			expect(fetchSpy).not.toHaveBeenCalled();
			expect(PersonaCommands.importPersonaImage).toHaveBeenCalledWith(
				'avatar',
				expect.stringMatching(/^data:image\/png;base64,/),
			);
			expect(PersonaCommands.importPersonas).toHaveBeenCalledWith([
				expect.objectContaining({
					name: 'Alvis',
					avatar_hash: 'aaaaaaaa',
					avatar_color: 7,
					bio: 'the whole bio',
					auto_tag_disabled: true,
					signature_emojis: [{name: '🌸'}],
					external_uuid: '1428573920012345678',
				}),
			]);
			expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('T'.repeat(90), undefined);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('refuses a zip that is not a Tyne export', async () => {
		await act(async () => {
			root.render(
				<PluralKitImportModal
					onClose={vi.fn()}
					data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--7"
				/>,
			);
		});
		const zip = zipSync({'other.txt': new TextEncoder().encode('hello')});
		await chooseFile(
			new File([zip as BlobPart], 'other.zip', {type: 'application/zip'}),
			'This .zip file is not a persona export from Tyne.',
		);
	});
});
