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
	// Every member new and nothing to decide, unless a test says otherwise.
	previewPersonaImport: vi.fn(async (request: {members: Array<unknown>; display_tag?: unknown}) => ({
		entries: request.members.map((_member, index) => ({index, kind: 'new'})),
		personas: [],
		display_tag: {decision: request.display_tag ? 'auto_apply' : 'none', current_text: null},
		untouched: 0,
		needs_review: false,
	})),
	applyPersonaImport: vi.fn(async () => ({personas: [], dropped: []})),
	deletePersona: vi.fn().mockResolvedValue(undefined),
	personaErrorMessage: vi.fn((_err: unknown, fallback: string) => fallback),
	exportPersonas: vi.fn(),
	importPersonaImage: vi.fn(async (kind: string) => ({
		hash: kind === 'avatar' ? 'aaaaaaaa' : 'bbbbbbbb',
		avatarColor: 7,
	})),
}));

vi.mock('@app/features/platform/utils/DownloadFile', () => ({
	downloadBlob: vi.fn(),
}));

vi.mock('@app/features/ui/commands/ToastCommands', () => ({
	createToast: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: vi.fn((m) => (typeof m === 'function' ? m() : m)),
	modal: vi.fn((fn) => fn),
	getTopModalKey: vi.fn(() => 'import-modal-key'),
	popWithKey: vi.fn(),
}));

import {PRODUCT_NAME} from '@app/features/app/config/ProductConstants';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {PluralKitImportModal} from '@app/features/persona/components/modals/PluralKitImportModal';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {downloadBlob} from '@app/features/platform/utils/DownloadFile';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {
	PersonaImportApplyRequestSchema,
	type PersonaImportPreviewRequest,
	type PersonaImportPreviewResponse,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {i18n} from '@lingui/core';
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

		expect(document.body.textContent).toContain('Import personas');
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

			await startImport();

			expect(PersonaCommands.previewPersonaImport).toHaveBeenCalledTimes(1);
			expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1);
			expect(appliedItems()).toEqual(
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
			// Nothing to decide on an account without personas: the system's tag (never its name) is used.
			expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('SOLAR', undefined);
			expect(document.body.textContent).toContain('2 personas added');
			expect(document.body.textContent).toContain('Earth');
		} finally {
			window.FileReader = originalFileReader;
		}
	});

	// The review opens only when something needs a decision; pictures are stored and personas written
	// only after Import, for the members whose choice needs them (tyne-chat/tyne#243).
	describe('the review', () => {
		const file = () =>
			new File(
				[
					JSON.stringify({
						members: [
							{
								id: 'aaaaa',
								name: 'Sun',
								description: 'Star',
								avatar_url: 'https://cdn.example/sun.png',
								privacy: PUBLIC,
							},
							{id: 'bbbbb', name: 'Earth', avatar_url: 'https://cdn.example/earth.png', privacy: PUBLIC},
						],
					}),
				],
				'pk.json',
				{type: 'application/json'},
			);

		// The server's answer, which names the stored copy of each member's picture it was sent.
		const answerFor = (request: PersonaImportPreviewRequest): PersonaImportPreviewResponse => ({
			entries: [
				{
					index: 0,
					kind: 'differs',
					persona_id: '100000000000000001',
					differences: [{field: 'bio', change: 'changed'}],
					avatar_hash: request.members[0]?.avatar?.hash ?? null,
				},
				{index: 1, kind: 'new', avatar_hash: request.members[1]?.avatar?.hash ?? null},
			],
			personas: [
				{
					id: '100000000000000001',
					name: 'Sun',
					bio: 'Old star',
					persona_tags: [],
					signature_emojis: [],
					use_count: 3,
					visibility: 'unlisted',
					auto_tag_disabled: false,
					created_at: '2026-09-01T00:00:00.000Z',
					updated_at: '2026-09-01T00:00:00.000Z',
				},
			],
			display_tag: {decision: 'none', current_text: null},
			untouched: 0,
			needs_review: true,
		});

		// The server stores each linked picture, with its own hash.
		const PICTURE_HASHES: Record<string, string> = {
			'https://cdn.example/sun.png': 'eeeeeee1',
			'https://cdn.example/earth.png': 'eeeeeee2',
		};
		const storingFetch = () =>
			vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as {urls: Array<string>};
				const results = Object.fromEntries(body.urls.map((url) => [url, {avatar_hash: PICTURE_HASHES[url]}]));
				return new Response(`${JSON.stringify({type: 'complete', total: body.urls.length, results})}\n`, {status: 200});
			});
		const requestedPictures = (fetchSpy: ReturnType<typeof storingFetch>) =>
			fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

		beforeEach(() => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockImplementationOnce(async (request) => answerFor(request));
		});

		async function openReview(fetchSpy: ReturnType<typeof vi.spyOn>): Promise<void> {
			await act(async () => {
				root.render(
					<PluralKitImportModal
						onClose={vi.fn()}
						data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--review"
					/>,
				);
			});
			await chooseFile(file(), 'Total Members2');
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(differsToggle('Sun')).toBeDefined());
			// Every picture was stored before the review, in one request.
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(PersonaCommands.applyPersonaImport).not.toHaveBeenCalled();
		}

		it('stores every picture first, compares them by hash, and applies only what the choices say', async () => {
			const fetchSpy = storingFetch();
			try {
				await openReview(fetchSpy);
				// Sun is listed collapsed, naming what differs and the safe choice.
				const toggle = differsToggle('Sun')!;
				expect(toggle.getAttribute('aria-expanded')).toBe('false');
				expect(toggle.textContent).toContain('Bio');
				expect(toggle.textContent).toContain("Keeping {productName}'s".replace('{productName}', PRODUCT_NAME));
				expect(differsBody()).toBeNull();
				expect(document.body.textContent).toContain('Import will {actions}'.replace('{actions}', 'add 1'));

				await act(async () => {
					importButton()?.click();
				});
				await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));

				// One request stored both pictures before the review; the comparison got their hashes.
				expect(requestedPictures(fetchSpy)).toEqual([
					{urls: ['https://cdn.example/sun.png', 'https://cdn.example/earth.png'], kind: 'avatar'},
				]);
				expect(vi.mocked(PersonaCommands.previewPersonaImport).mock.calls[0]?.[0].members.map((m) => m.avatar)).toEqual(
					[
						{url: 'https://cdn.example/sun.png', hash: 'eeeeeee1'},
						{url: 'https://cdn.example/earth.png', hash: 'eeeeeee2'},
					],
				);
				// Sun keeps its own details (no action); only Earth is added, with its stored picture.
				expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]?.[0].actions).toEqual([
					{action: 'add', item: expect.objectContaining({name: 'Earth', avatar_hash: 'eeeeeee2'})},
				]);
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it("opens a differing persona to compare, and takes the file's version when chosen", async () => {
			const fetchSpy = storingFetch();
			try {
				await openReview(fetchSpy);
				await act(async () => {
					differsToggle('Sun')!.click();
				});
				expect(differsToggle('Sun')!.getAttribute('aria-expanded')).toBe('true');
				expect(differsBody()?.textContent).toContain('Sun is different in your file');
				const useFile = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[name="import-0"]'))[0]!;
				await act(async () => {
					useFile.click();
				});
				expect(differsToggle('Sun')!.textContent).toContain("Using the file's");

				// Closed again, the choice stays.
				await act(async () => {
					differsToggle('Sun')!.click();
				});
				expect(differsBody()).toBeNull();
				expect(differsToggle('Sun')!.textContent).toContain("Using the file's");

				await act(async () => {
					importButton()?.click();
				});
				await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
				expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]?.[0].actions).toEqual(
					expect.arrayContaining([expect.objectContaining({action: 'use_file', persona_id: '100000000000000001'})]),
				);
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it("keeps both: adds the file's Sun as a renamed, unlinked copy and leaves Tyne's Sun as it is", async () => {
			const fetchSpy = storingFetch();
			try {
				await openReview(fetchSpy);
				await act(async () => {
					differsToggle('Sun')!.click();
				});
				// The switch reads Use the file's · Keep both · Use Tyne's, on Tyne's to begin with.
				const [useFile, keepBoth, useTyne] = Array.from(
					document.body.querySelectorAll<HTMLInputElement>('input[name="import-0"]'),
				);
				expect(useTyne?.checked).toBe(true);
				expect(useFile?.checked).toBe(false);
				await act(async () => {
					keepBoth!.click();
				});
				expect(differsToggle('Sun')!.textContent).toContain('Keeping both');
				const name = document.body.querySelector<HTMLInputElement>('#import-copy-name-0')!;
				expect(name.value).toBe('Sun (2)');
				await act(async () => {
					const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
					setter.call(name, 'Sun, older');
					name.dispatchEvent(new Event('input', {bubbles: true}));
				});

				await act(async () => {
					importButton()?.click();
				});
				await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
				const request = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0];
				expect(request.actions).toEqual([
					expect.objectContaining({
						action: 'add',
						item: expect.objectContaining({name: 'Sun, older', external_uuid: null, avatar_hash: 'eeeeeee1'}),
					}),
					expect.objectContaining({action: 'add', item: expect.objectContaining({name: 'Earth'})}),
				]);
				expect(PersonaImportApplyRequestSchema.safeParse(request).success).toBe(true);
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it('asks before closing the review, and closes only this dialog when told to stop', async () => {
			const fetchSpy = storingFetch();
			const onClose = vi.fn();
			try {
				await act(async () => {
					root.render(
						<PluralKitImportModal
							onClose={onClose}
							data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--close"
						/>,
					);
				});
				await chooseFile(file(), 'Total Members2');
				await act(async () => {
					importButton()?.click();
				});
				await settled(() => expect(differsToggle('Sun')).toBeDefined());
				vi.mocked(ModalCommands.push).mockClear();

				await act(async () => {
					document.querySelector<HTMLButtonElement>('[data-flx="app.modal.header.button.close"]')?.click();
				});
				expect(onClose).not.toHaveBeenCalled();
				expect(ModalCommands.push).toHaveBeenCalledTimes(1);
				expect(differsToggle('Sun')).toBeDefined();

				// "Stop importing" closes the import dialog by its own key (the confirmation closes itself).
				const confirm = vi.mocked(ModalCommands.push).mock.results[0]?.value as React.ReactElement<{
					title: string;
					onPrimary: () => void;
				}>;
				expect(confirm.props.title).toBe('Stop this import?');
				confirm.props.onPrimary();
				expect(ModalCommands.popWithKey).toHaveBeenCalledWith('import-modal-key');
				expect(PersonaCommands.applyPersonaImport).not.toHaveBeenCalled();
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it("tries a failed download once, still opens the review, and keeps Tyne's picture", async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockImplementation(async () => new Response('{"message": "Rate limited"}', {status: 429}));
			try {
				await openReview(fetchSpy);
				// The comparison got the links only, without a stored copy.
				expect(vi.mocked(PersonaCommands.previewPersonaImport).mock.calls[0]?.[0].members.map((m) => m.avatar)).toEqual(
					[{url: 'https://cdn.example/sun.png'}, {url: 'https://cdn.example/earth.png'}],
				);
				await act(async () => {
					differsToggle('Sun')!.click();
				});
				expect(differsBody()?.textContent).toContain("The file's picture couldn't be loaded");

				// Back and Import again: nothing is stored again.
				await act(async () => {
					Array.from(document.body.querySelectorAll('button'))
						.find((button) => button.textContent?.trim() === 'Back')
						?.click();
				});
				vi.mocked(PersonaCommands.previewPersonaImport).mockImplementationOnce(async (request) => answerFor(request));
				await act(async () => {
					importButton()?.click();
				});
				await settled(() => expect(PersonaCommands.previewPersonaImport).toHaveBeenCalledTimes(2));
				await settled(() => expect(differsToggle('Sun')).toBeDefined());
				expect(fetchSpy).toHaveBeenCalledTimes(1);

				// Earth is added without a picture, and the import says why.
				await act(async () => {
					importButton()?.click();
				});
				await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
				const [added] = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions;
				expect(added).toMatchObject({action: 'add', item: {name: 'Earth'}});
				expect((added as {item: {avatar_hash?: string | null}}).item.avatar_hash ?? null).toBeNull();
				await settled(() => expect(document.body.textContent).toContain('Avatar image failed to download'));
				expect(fetchSpy).toHaveBeenCalledTimes(1);
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it('stays on the review when the import is refused', async () => {
			const fetchSpy = storingFetch();
			vi.mocked(PersonaCommands.applyPersonaImport).mockRejectedValueOnce(new Error('This tag is already taken.'));
			try {
				await openReview(fetchSpy);
				await act(async () => {
					importButton()?.click();
				});
				await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
				await settled(() => expect(differsToggle('Sun')).toBeDefined());
				expect(document.body.textContent).not.toContain('personas added');
			} finally {
				fetchSpy.mockRestore();
			}
		});
	});

	describe('a backup before importing into an account with personas', () => {
		const file = () =>
			new File([JSON.stringify({members: [{id: 'fffff', name: 'Fern', privacy: PUBLIC}]})], 'pk.json', {
				type: 'application/json',
			});
		const button = (text: string) =>
			Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

		beforeEach(() => {
			PersonaStore.setPersonas([
				{
					id: '100000000000000005',
					name: 'Moss',
					persona_tags: [],
					signature_emojis: [],
					use_count: 0,
					visibility: 'public',
					auto_tag_disabled: false,
					created_at: '2026-09-01T00:00:00.000Z',
					updated_at: '2026-09-01T00:00:00.000Z',
				},
			]);
		});

		async function pressImport(): Promise<void> {
			await act(async () => {
				root.render(<PluralKitImportModal onClose={vi.fn()} data-flx="persona.plural-kit-import-modal-test.backup" />);
			});
			await chooseFile(file(), 'Total Members1');
			await act(async () => {
				importButton()?.click();
			});
			expect(document.body.textContent).toContain('Use Export to make a backup before continuing.');
			expect(PersonaCommands.previewPersonaImport).not.toHaveBeenCalled();
		}

		it('offers a backup first, and Skip imports without one', async () => {
			await pressImport();
			await act(async () => {
				button('Skip')?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			expect(PersonaCommands.exportPersonas).not.toHaveBeenCalled();
		});

		it('saves the export, then imports', async () => {
			const blob = new Blob(['zip']);
			vi.mocked(PersonaCommands.exportPersonas).mockResolvedValueOnce({blob, fileName: 'Tyne personas.zip'});
			await pressImport();
			await act(async () => {
				button('Export')?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			expect(downloadBlob).toHaveBeenCalledWith(blob, 'Tyne personas.zip');
		});

		it('stays on the backup step when the export fails', async () => {
			vi.mocked(PersonaCommands.exportPersonas).mockRejectedValueOnce(new Error('offline'));
			await pressImport();
			await act(async () => {
				button('Export')?.click();
			});
			await settled(() => expect(ToastCommands.error).toHaveBeenCalledWith('Could not export your personas.'));
			expect(document.body.textContent).toContain('Use Export to make a backup before continuing.');
			expect(PersonaCommands.previewPersonaImport).not.toHaveBeenCalled();
			expect(downloadBlob).not.toHaveBeenCalled();
		});
	});

	it('lists the personas that already match, and the ones not in the file, behind Show', async () => {
		const persona = (id: string, name: string) => ({
			id,
			name,
			persona_tags: [],
			signature_emojis: [],
			use_count: 1,
			visibility: 'public' as const,
			auto_tag_disabled: false,
			created_at: '2026-09-01T00:00:00.000Z',
			updated_at: '2026-09-01T00:00:00.000Z',
		});
		PersonaStore.setPersonas([persona('100000000000000021', 'Sun'), persona('100000000000000022', 'Comet')]);
		vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
			entries: [
				{index: 0, kind: 'up_to_date', persona_id: '100000000000000021'},
				{index: 1, kind: 'tag_in_use', clashes: [{tag: {prefix: 'mo:'}, held_by_persona_id: '100000000000000022'}]},
			],
			personas: [persona('100000000000000021', 'Sun'), persona('100000000000000022', 'Comet')],
			display_tag: {decision: 'none', current_text: null},
			untouched: 1,
			needs_review: true,
		});
		const file = new File(
			[
				JSON.stringify({
					members: [
						{id: 'aaaaa', name: 'Sun', privacy: PUBLIC},
						{id: 'bbbbb', name: 'Moon', proxy_tags: [{prefix: 'mo:'}], privacy: PUBLIC},
					],
				}),
			],
			'pk.json',
			{type: 'application/json'},
		);
		await act(async () => {
			root.render(<PluralKitImportModal onClose={vi.fn()} data-flx="persona.plural-kit-import-modal-test.ready" />);
		});
		await chooseFile(file, 'Total Members2');
		// The backup step first, since the account has personas.
		await act(async () => {
			importButton()?.click();
		});
		await act(async () => {
			Array.from(document.body.querySelectorAll('button'))
				.find((b) => b.textContent?.trim() === 'Skip')
				?.click();
		});
		const lists = () =>
			Array.from(
				document.body.querySelectorAll(
					'[data-flx="persona.persona-import-review.ready.matched.list"], [data-flx="persona.persona-import-review.ready.persona-list"]',
				),
			);
		await settled(() =>
			expect(document.body.querySelectorAll('[data-flx="persona.persona-import-review.ready.toggle"]')).toHaveLength(2),
		);
		expect(lists()).toHaveLength(0);
		for (const toggle of Array.from(
			document.body.querySelectorAll<HTMLButtonElement>('[data-flx="persona.persona-import-review.ready.toggle"]'),
		)) {
			await act(async () => {
				toggle.click();
			});
		}
		// Both open at once: Sun matches (one list with the connected ones); Comet is in no entry's match.
		const names = (list: Element) =>
			Array.from(list.querySelectorAll('[data-flx="persona.persona-import-review.ready.persona-name"]')).map(
				(name) => name.textContent,
			);
		expect(lists().map(names)).toEqual([['Sun'], ['Comet']]);
	});

	it("leaves a deleted persona deleted, and brings it back as it was or with the file's details", async () => {
		vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
			entries: [{index: 0, kind: 'deleted', persona_id: '100000000000000031'}],
			personas: [
				{
					id: '100000000000000031',
					name: 'Pip',
					bio: 'Old',
					persona_tags: [{prefix: 'pi:'}],
					signature_emojis: [],
					use_count: 9,
					visibility: 'unlisted',
					auto_tag_disabled: false,
					created_at: '2026-09-01T00:00:00.000Z',
					updated_at: '2026-09-01T00:00:00.000Z',
					deleted_at: '2026-10-01T00:00:00.000Z',
				},
			],
			display_tag: {decision: 'none', current_text: null},
			untouched: 0,
			needs_review: true,
		});
		const file = new File(
			[
				JSON.stringify({
					members: [{id: 'ppppp', name: 'Pip', description: 'New', proxy_tags: [{prefix: 'pi:'}], privacy: PUBLIC}],
				}),
			],
			'pk.json',
			{type: 'application/json'},
		);
		await act(async () => {
			root.render(<PluralKitImportModal onClose={vi.fn()} data-flx="persona.plural-kit-import-modal-test.deleted" />);
		});
		await chooseFile(file, 'Total Members1');
		await act(async () => {
			importButton()?.click();
		});
		const toggle = () =>
			document.body.querySelector<HTMLButtonElement>('[data-flx="persona.persona-import-review.deleted.toggle"]');
		await settled(() => expect(toggle()?.textContent).toContain('Staying deleted'));
		await act(async () => {
			toggle()!.click();
		});
		const radios = (name: string) =>
			Array.from(document.body.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
		const [leave, bringBack] = radios('import-back-0');
		expect(leave?.checked).toBe(true);
		expect(radios('import-0')).toHaveLength(0);
		await act(async () => {
			bringBack!.click();
		});
		expect(toggle()?.textContent).toContain('Bringing back');
		expect(document.body.textContent).toContain('Comes back as it was');
		// Use the file's: it comes back with the file's details.
		await act(async () => {
			radios('import-0')[0]!.click();
		});
		await act(async () => {
			importButton()?.click();
		});
		await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
		expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions).toEqual([
			expect.objectContaining({
				action: 'use_file',
				persona_id: '100000000000000031',
				item: expect.objectContaining({bio: 'New', external_uuid: 'ppppp'}),
			}),
		]);
	});

	it('only asks whether to bring back a deleted persona the file has exactly as it was', async () => {
		vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
			entries: [{index: 0, kind: 'deleted', persona_id: '100000000000000041'}],
			personas: [
				{
					id: '100000000000000041',
					name: 'Alex',
					bio: 'Same bio',
					persona_tags: [{prefix: 'al:'}],
					signature_emojis: [],
					use_count: 2,
					visibility: 'unlisted',
					auto_tag_disabled: false,
					created_at: '2026-09-01T00:00:00.000Z',
					updated_at: '2026-09-01T00:00:00.000Z',
					deleted_at: '2026-10-01T00:00:00.000Z',
				},
			],
			display_tag: {decision: 'none', current_text: null},
			untouched: 0,
			needs_review: true,
		});
		const file = new File(
			[
				JSON.stringify({
					members: [
						{id: 'xxxxx', name: 'Alex', description: 'Same bio', proxy_tags: [{prefix: 'al:'}], privacy: PUBLIC},
					],
				}),
			],
			'pk.json',
			{type: 'application/json'},
		);
		await act(async () => {
			root.render(
				<PluralKitImportModal onClose={vi.fn()} data-flx="persona.plural-kit-import-modal-test.deleted-same" />,
			);
		});
		await chooseFile(file, 'Total Members1');
		await act(async () => {
			importButton()?.click();
		});
		const toggle = () =>
			document.body.querySelector<HTMLButtonElement>('[data-flx="persona.persona-import-review.deleted.toggle"]');
		await settled(() => expect(toggle()).not.toBeNull());
		await act(async () => {
			toggle()!.click();
		});
		const radios = (name: string) =>
			Array.from(document.body.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
		await act(async () => {
			radios('import-back-0')[1]!.click();
		});
		// No second question: Use the file's and Use Tyne's would bring back the same thing.
		expect(radios('import-0')).toHaveLength(0);
		expect(document.body.textContent).toContain('Comes back as it was');
		await act(async () => {
			importButton()?.click();
		});
		await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
		expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions).toEqual([
			{action: 'restore', persona_id: '100000000000000041'},
		]);
	});

	describe('more of the review', () => {
		const tyne = (id: string, name: string, tags: Array<{prefix: string}>, extra: Record<string, unknown> = {}) => ({
			id,
			name,
			persona_tags: tags,
			signature_emojis: [],
			use_count: 3,
			visibility: 'public' as const,
			auto_tag_disabled: false,
			created_at: '2026-09-01T00:00:00.000Z',
			updated_at: '2026-09-01T00:00:00.000Z',
			...extra,
		});
		const pkFile = (members: Array<Record<string, unknown>>, tag?: string) =>
			new File(
				[JSON.stringify({...(tag ? {tag} : {}), members: members.map((m) => ({privacy: PUBLIC, ...m}))})],
				'pk.json',
				{
					type: 'application/json',
				},
			);
		const radios = (name: string) =>
			Array.from(document.body.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
		const clickAll = async (selector: string) => {
			for (const element of Array.from(document.body.querySelectorAll<HTMLElement>(selector))) {
				await act(async () => {
					element.click();
				});
			}
		};
		async function review(file: File, summary: string): Promise<void> {
			await act(async () => {
				root.render(<PluralKitImportModal onClose={vi.fn()} data-flx="persona.plural-kit-import-modal-test.more" />);
			});
			await chooseFile(file, summary);
			await act(async () => {
				importButton()?.click();
			});
		}
		const typeInto = async (field: HTMLInputElement, value: string) => {
			await act(async () => {
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
				field.dispatchEvent(new Event('input', {bubbles: true}));
			});
		};

		it('picks among several personas, and a persona one member was given cannot be given to another', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [0, 1].map((index) => ({
					index,
					kind: 'cant_tell' as const,
					candidates: [
						{persona_id: '100000000000000051', matched_on: 'name' as const, linked_elsewhere: false},
						{persona_id: '100000000000000052', matched_on: 'name' as const, linked_elsewhere: false},
					],
				})),
				personas: [
					tyne('100000000000000051', 'Kenoma', [{prefix: 'Ke:'}]),
					tyne('100000000000000052', 'Kenoma', [{prefix: 'Kn:'}]),
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([
					{id: 'k1', name: 'Kenoma', proxy_tags: [{prefix: 'Kx:'}]},
					{id: 'k2', name: 'Kenoma', proxy_tags: [{prefix: 'Ky:'}]},
				]),
				'Total Members2',
			);
			await settled(() =>
				expect(
					document.body.querySelectorAll('[data-flx="persona.persona-import-review.cant-tell.toggle"]'),
				).toHaveLength(2),
			);
			await clickAll('[data-flx="persona.persona-import-review.cant-tell.toggle"]');
			expect(radios('import-pick-0')).toHaveLength(3);
			// The second persona, then the first: the switch follows the pick.
			await act(async () => {
				radios('import-pick-0')[1]!.click();
			});
			await act(async () => {
				radios('import-pick-0')[0]!.click();
			});
			expect(radios('import-pick-0')[0]?.checked).toBe(true);
			// The other member can no longer be given the first persona.
			expect(radios('import-pick-1')[0]?.disabled).toBe(true);
			expect(radios('import-pick-1')[1]?.disabled).toBe(false);

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions).toEqual([
				{action: 'link', persona_id: '100000000000000051', external_uuid: 'k1'},
			]);
		});

		it('shows the other member that uses the same tag, and keeps one with a tag of its own', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{index: 0, kind: 'tag_in_use', clashes: [{tag: {prefix: 'mo:'}, shared_with_member: 1}]},
					{index: 1, kind: 'new'},
				],
				personas: [],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([
					{id: 'm1', name: 'Moth', proxy_tags: [{prefix: 'mo:'}]},
					{id: 'm2', name: 'Moon', proxy_tags: [{prefix: 'mo:'}]},
				]),
				'Total Members2',
			);
			await settled(() =>
				expect(document.body.querySelector('[data-flx="persona.persona-import-review.taken.toggle"]')).not.toBeNull(),
			);
			await clickAll('[data-flx="persona.persona-import-review.taken.toggle"]');
			expect(document.body.textContent).toContain('is also used by Moon in your file');
			const holder = document.body.querySelector('[data-flx="persona.persona-import-review.taken.holder"]');
			expect(holder?.textContent).toContain('Moon');
			await act(async () => {
				radios('import-0')[1]!.click();
			});
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const [moth, moon] = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions;
			expect(moth).toMatchObject({action: 'add', item: {name: 'Moth', external_uuid: 'm1'}});
			expect(moth?.item?.persona_tags).not.toContainEqual({prefix: 'mo:'});
			expect(moon).toMatchObject({action: 'add', item: {name: 'Moon', persona_tags: [{prefix: 'mo:'}]}});
		});

		it('blocks Import while two choices would give one tag to two personas', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{index: 0, kind: 'tag_in_use', clashes: [{tag: {prefix: 'ly:'}, held_by_persona_id: '100000000000000061'}]},
				],
				personas: [
					tyne('100000000000000061', 'Lyra ✦', [{prefix: 'ly:'}]),
					tyne('100000000000000062', 'Wren', [{prefix: 'wr:'}]),
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(pkFile([{id: 'l1', name: 'Lyra ✧', proxy_tags: [{prefix: 'ly:'}]}]), 'Total Members1');
			await settled(() =>
				expect(document.body.querySelector('[data-flx="persona.persona-import-review.taken.toggle"]')).not.toBeNull(),
			);
			await clickAll('[data-flx="persona.persona-import-review.taken.toggle"]');
			await act(async () => {
				radios('import-0')[1]!.click();
			});
			const field = document.body.querySelector('input[id^="import-tag-"]') as HTMLInputElement;
			await typeInto(field, 'wr:');
			expect(document.body.textContent).toContain('Wren already has it');
			const banner = document.body.querySelector('[data-flx="persona.persona-import-review.conflicts"]');
			expect(banner?.textContent).toContain('wr:text');
			expect(importButton()?.disabled).toBe(true);
			await act(async () => {
				importButton()?.click();
			});
			expect(PersonaCommands.applyPersonaImport).not.toHaveBeenCalled();
			// A free tag lifts the block.
			await typeInto(field, 'lyx:');
			expect(document.body.querySelector('[data-flx="persona.persona-import-review.conflicts"]')).toBeNull();
			expect(importButton()?.disabled).toBe(false);
		});

		it("uses the file's display tag when its box is chosen, with no backup step for an account without personas", async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [{index: 0, kind: 'new'}],
				personas: [],
				display_tag: {decision: 'ask', current_text: '[ Lantern ]'},
				untouched: 0,
				needs_review: true,
			});
			await review(pkFile([{id: 's1', name: 'Sol'}], 'SOLAR'), 'Total Members1');
			expect(document.body.textContent).not.toContain('Use Export to make a backup before continuing.');
			await settled(() => expect(radios('import-display-tag')).toHaveLength(2));
			const [fileBox, tyneBox] = radios('import-display-tag');
			expect(tyneBox?.checked).toBe(true);
			await act(async () => {
				fileBox!.click();
			});
			expect(document.body.textContent).toContain('Replaces your display tag');
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('SOLAR', undefined));
		});

		it('says on the finished screen who was skipped, which tags were left out and what a restore came back without', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [{index: 0, kind: 'deleted', persona_id: '100000000000000071'}],
				personas: [tyne('100000000000000071', 'Pip', [{prefix: 'pi:'}], {deleted_at: '2026-10-01T00:00:00.000Z'})],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			vi.mocked(PersonaCommands.applyPersonaImport).mockResolvedValueOnce({
				personas: [tyne('100000000000000071', 'Pip', [])],
				dropped: [{persona_id: '100000000000000071', tags: [{prefix: 'pi:'}], signature_emojis: []}],
			});
			const sixTags = ['a:', 'b:', 'c:', 'd:', 'e:', 'f:'].map((prefix) => ({prefix}));
			await review(
				pkFile([
					{id: 'n0', name: null},
					{id: 'ppppp', name: 'Pip', proxy_tags: sixTags},
				]),
				'Total Members2',
			);
			await settled(() =>
				expect(document.body.querySelector('[data-flx="persona.persona-import-review.deleted.toggle"]')).not.toBeNull(),
			);
			await clickAll('[data-flx="persona.persona-import-review.deleted.toggle"]');
			await act(async () => {
				radios('import-back-0')[1]!.click();
			});
			await act(async () => {
				radios('import-0')[0]!.click();
			});
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(document.body.textContent).toContain('Import finished'));
			const text = document.body.textContent ?? '';
			expect(text).toContain('Skipped member because they have no name configured.');
			expect(text).toContain('Some proxy tags were left out');
			expect(text).toContain('Came back without pi:text');
		});

		it('keeps both beside a picked persona: it is connected as it is, and nobody else can be given it', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [0, 1].map((index) => ({
					index,
					kind: 'cant_tell' as const,
					candidates: [
						{persona_id: '100000000000000051', matched_on: 'name' as const, linked_elsewhere: false},
						{persona_id: '100000000000000052', matched_on: 'name' as const, linked_elsewhere: false},
					],
				})),
				personas: [
					tyne('100000000000000051', 'Kenoma', [{prefix: 'Ke:'}]),
					tyne('100000000000000052', 'Kenoma', [{prefix: 'Kn:'}]),
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([
					{id: 'k1', name: 'Kenoma', proxy_tags: [{prefix: 'Kx:'}]},
					{id: 'k2', name: 'Kenoma', proxy_tags: [{prefix: 'Ky:'}]},
				]),
				'Total Members2',
			);
			await settled(() =>
				expect(
					document.body.querySelectorAll('[data-flx="persona.persona-import-review.cant-tell.toggle"]'),
				).toHaveLength(2),
			);
			await clickAll('[data-flx="persona.persona-import-review.cant-tell.toggle"]');
			await act(async () => {
				radios('import-pick-0')[0]!.click();
			});
			await act(async () => {
				radios('import-0')[1]!.click();
			});
			const choice = () =>
				document.body.querySelector('[data-flx="persona.persona-import-review.cant-tell.choice"]')?.textContent;
			expect(choice()).toBe('Keeping both');
			expect(
				document.body.querySelector(
					'[data-flx="persona.persona-import-review.cant-tell.body"] [data-flx="persona.persona-import-review.copy-fields"]',
				),
			).not.toBeNull();
			// Kept beside the copy, the persona is still connected to this member, so not to the other.
			expect(radios('import-pick-1')[0]?.disabled).toBe(true);
			// Nor once it takes the file's version.
			await act(async () => {
				radios('import-0')[0]!.click();
			});
			expect(choice()).toBe("Using the file's");
			expect(radios('import-pick-1')[0]?.disabled).toBe(true);
			// Picking the other persona keeps the choice and frees the first.
			await act(async () => {
				radios('import-pick-0')[1]!.click();
			});
			expect(choice()).toBe("Using the file's");
			expect(radios('import-pick-1')[0]?.disabled).toBe(false);
			expect(radios('import-pick-1')[1]?.disabled).toBe(true);
			await act(async () => {
				radios('import-pick-0')[0]!.click();
			});
			await act(async () => {
				radios('import-0')[1]!.click();
			});

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const request = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0];
			expect(request.actions).toEqual([
				{action: 'link', persona_id: '100000000000000051', external_uuid: 'k1'},
				expect.objectContaining({action: 'add', item: expect.objectContaining({external_uuid: null})}),
			]);
			expect(request.actions[1]?.item?.name).not.toBe('Kenoma');
			expect(PersonaImportApplyRequestSchema.safeParse(request).success).toBe(true);
		});

		it("marks a picked persona's differences: pronouns, colour and the words of the bio", async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{
						index: 0,
						kind: 'cant_tell',
						candidates: [{persona_id: '100000000000000053', matched_on: 'name', linked_elsewhere: false}],
					},
				],
				personas: [
					tyne('100000000000000053', 'Wren', [{prefix: 'wr:'}], {
						pronouns: 'she/her',
						color: 0x112233,
						bio: 'Keeps the log.\nLikes rain.',
					}),
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([
					{
						id: 'w1',
						name: 'Wren',
						pronouns: 'they/them',
						color: 'ff0000',
						description: 'Keeps the log.\nHates fog.',
						proxy_tags: [{prefix: 'wr:'}],
					},
				]),
				'Total Members1',
			);
			await settled(() =>
				expect(
					document.body.querySelector('[data-flx="persona.persona-import-review.cant-tell.toggle"]'),
				).not.toBeNull(),
			);
			await clickAll('[data-flx="persona.persona-import-review.cant-tell.toggle"]');
			await act(async () => {
				radios('import-pick-0')[0]!.click();
			});
			const texts = (flx: string) =>
				Array.from(document.body.querySelectorAll(`[data-flx="persona.persona-import-review.version.${flx}"]`)).map(
					(element) => element.textContent,
				);
			// The colour shows only because it differs, on both cards.
			expect(texts('color')).toEqual(['#ff0000', '#112233']);
			// Each bio marks only what the other lacks; the shared line stays plain, line breaks included.
			expect(texts('bio-changed')).toEqual(['Hates fog.', 'Likes rain.']);
			expect(texts('bio-same')).toEqual(['Keeps the log.\n', 'Keeps the log.\n']);
			expect(texts('bio')).toEqual(['Keeps the log.\nHates fog.', 'Keeps the log.\nLikes rain.']);
		});

		it('keeps both beside a deleted persona: it comes back as it was, next to a copy', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [{index: 0, kind: 'deleted', persona_id: '100000000000000072'}],
				personas: [
					tyne('100000000000000072', 'Pip', [{prefix: 'pi:'}], {
						bio: 'Old',
						color: 0x112233,
						deleted_at: '2026-10-01T00:00:00.000Z',
					}),
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([{id: 'ppppp', name: 'Pip', description: 'New', proxy_tags: [{prefix: 'pi:'}]}]),
				'Total Members1',
			);
			await settled(() =>
				expect(document.body.querySelector('[data-flx="persona.persona-import-review.deleted.toggle"]')).not.toBeNull(),
			);
			await clickAll('[data-flx="persona.persona-import-review.deleted.toggle"]');
			const choice = () =>
				document.body.querySelector('[data-flx="persona.persona-import-review.deleted.choice"]')?.textContent;
			// Bring back, then Leave deleted again: nothing is asked any more.
			await act(async () => {
				radios('import-back-0')[1]!.click();
			});
			expect(radios('import-0')).toHaveLength(3);
			// The file has no colour: its card says so, in the colour's row.
			const colourRows = Array.from(
				document.body.querySelectorAll('[data-flx="persona.persona-import-review.version.color"]'),
			).map((row) => row.textContent);
			expect(colourRows).toEqual(['#112233']);
			expect(document.body.textContent).toContain('No colour');
			await act(async () => {
				radios('import-back-0')[0]!.click();
			});
			expect(choice()).toBe('Staying deleted');
			expect(radios('import-0')).toHaveLength(0);
			await act(async () => {
				radios('import-back-0')[1]!.click();
			});
			await act(async () => {
				radios('import-0')[1]!.click();
			});
			expect(choice()).toBe('Keeping both');
			expect(
				document.body.querySelector(
					'[data-flx="persona.persona-import-review.deleted.body"] [data-flx="persona.persona-import-review.copy-fields"]',
				),
			).not.toBeNull();
			// Back on the switch, Bring back stays chosen.
			expect(radios('import-back-0')[1]?.checked).toBe(true);
			// The copy cannot have the tag the restored persona takes back.
			const tagField = document.body.querySelector<HTMLInputElement>('input[id^="import-tag-"]');
			expect(tagField?.value).not.toBe('pi:text');

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const request = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0];
			expect(request.actions).toEqual([
				{action: 'restore', persona_id: '100000000000000072'},
				expect.objectContaining({action: 'add', item: expect.objectContaining({external_uuid: null, bio: 'New'})}),
			]);
			expect(request.actions[1]?.item?.persona_tags).not.toContainEqual({prefix: 'pi:'});
			expect(PersonaImportApplyRequestSchema.safeParse(request).success).toBe(true);
		});

		it("lists a persona probably the same with the exact matches and always connects it, and takes Tyne's back", async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{index: 0, kind: 'probably_same', persona_id: '100000000000000111'},
					{
						index: 1,
						kind: 'differs',
						persona_id: '100000000000000112',
						differences: [{field: 'bio', change: 'changed'}],
					},
				],
				personas: [
					tyne('100000000000000111', 'Alpha', [{prefix: 'al:'}]),
					tyne('100000000000000112', 'Beta', [], {bio: 'Old'}),
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([
					{id: 'a1', name: 'Alpha', proxy_tags: [{prefix: 'al:'}]},
					{id: 'b1', name: 'Beta', description: 'New'},
				]),
				'Total Members2',
			);
			const matchedToggle = () =>
				document.body.querySelector<HTMLButtonElement>(
					'[data-flx="persona.persona-import-review.ready.matched"] [data-flx="persona.persona-import-review.ready.toggle"]',
				);
			await settled(() => expect(matchedToggle()).not.toBeNull());
			await act(async () => {
				matchedToggle()!.click();
			});
			const matched = document.body.querySelector('[data-flx="persona.persona-import-review.ready.matched.list"]');
			expect(matched?.textContent).toContain('Alpha');
			// Nothing to untick: an exact match is always connected.
			expect(matched?.querySelector('input')).toBeNull();
			// Beta: the file's version, then Tyne's again, which changes nothing.
			await clickAll('[data-flx="persona.persona-import-review.differs.toggle"]');
			const [useFile, , useTyne] = radios('import-1');
			await act(async () => {
				useFile!.click();
			});
			expect(useFile?.checked).toBe(true);
			await act(async () => {
				useTyne!.click();
			});
			expect(radios('import-1')[2]?.checked).toBe(true);

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions).toEqual([
				{action: 'link', persona_id: '100000000000000111', external_uuid: 'a1'},
			]);
		});

		it('lists new members by name, and leaves one out when it is unticked', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{index: 0, kind: 'new'},
					{index: 1, kind: 'new'},
					{
						index: 2,
						kind: 'differs',
						persona_id: '100000000000000081',
						differences: [{field: 'bio', change: 'changed'}],
					},
				],
				personas: [tyne('100000000000000081', 'Comet', [], {bio: 'Old'})],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([
					{id: 'n1', name: 'Nova'},
					{id: 'n2', name: 'Nebula'},
					{id: 'c1', name: 'Comet', description: 'New'},
				]),
				'Total Members3',
			);
			const toggle = () =>
				document.body.querySelector<HTMLButtonElement>(
					'[data-flx="persona.persona-import-review.ready.new"] [data-flx="persona.persona-import-review.ready.toggle"]',
				);
			await settled(() => expect(toggle()).not.toBeNull());
			await act(async () => {
				toggle()!.click();
			});
			const boxes = () =>
				Array.from(
					document.body.querySelectorAll<HTMLInputElement>(
						'[data-flx="persona.persona-import-review.ready.new.checkbox"]',
					),
				);
			// Sorted by name, each ticked.
			const items = () =>
				Array.from(document.body.querySelectorAll('[data-flx="persona.persona-import-review.ready.new.item"]')).map(
					(item) => item.textContent,
				);
			// Each row is its initial (no picture) and its name.
			expect(items()).toEqual(['NNebula', 'NNova']);
			expect(boxes().map((box) => box.checked)).toEqual([true, true]);
			await act(async () => {
				boxes()[0]!.click();
			});
			expect(boxes().map((box) => box.checked)).toEqual([false, true]);
			// Hide and Show again: the choice stays.
			await act(async () => {
				toggle()!.click();
			});
			expect(boxes()).toHaveLength(0);
			await act(async () => {
				toggle()!.click();
			});
			expect(boxes().map((box) => box.checked)).toEqual([false, true]);
			// Ticked again, then unticked: only Nova is added.
			await act(async () => {
				boxes()[0]!.click();
			});
			expect(boxes().map((box) => box.checked)).toEqual([true, true]);
			await act(async () => {
				boxes()[0]!.click();
			});

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions).toEqual([
				expect.objectContaining({action: 'add', item: expect.objectContaining({name: 'Nova', external_uuid: 'n1'})}),
			]);
		});

		it('asks for a tag in place of each taken one, takes an empty field as no tag, and Skip leaves it out again', async () => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{
						index: 0,
						kind: 'tag_in_use',
						clashes: [
							{tag: {prefix: 'ly:'}, held_by_persona_id: '100000000000000091'},
							{tag: {prefix: 'lyr:'}, held_by_persona_id: '100000000000000091'},
						],
					},
				],
				personas: [tyne('100000000000000091', 'Lyra ✦', [{prefix: 'ly:'}, {prefix: 'lyr:'}])],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
			await review(
				pkFile([{id: 'l1', name: 'Lyra ✧', proxy_tags: [{prefix: 'ly:'}, {prefix: 'lyr:'}, {prefix: 'ly2:'}]}]),
				'Total Members1',
			);
			await settled(() =>
				expect(document.body.querySelector('[data-flx="persona.persona-import-review.taken.toggle"]')).not.toBeNull(),
			);
			await clickAll('[data-flx="persona.persona-import-review.taken.toggle"]');
			await act(async () => {
				radios('import-0')[1]!.click();
			});
			const labels = Array.from(
				document.body.querySelectorAll('[data-flx="persona.persona-import-review.tag-field.label"]'),
			).map((label) => label.textContent);
			expect(labels).toEqual(['Instead of ly:text', 'Instead of lyr:text']);
			const fields = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[id^="import-tag-"]'));
			expect(fields.map((field) => field.value)).toEqual(['lyra:', 'lyr2:']);
			await typeInto(fields[0]!, '');
			const statuses = () =>
				Array.from(document.body.querySelectorAll('[data-flx="persona.persona-import-review.tag-field.status"]')).map(
					(status) => status.textContent,
				);
			expect(statuses()).toEqual(['No tag: added without one', 'Free']);
			// Skip, then Keep again: it starts over from the suggestions.
			await act(async () => {
				radios('import-0')[0]!.click();
			});
			expect(document.body.querySelectorAll('input[id^="import-tag-"]')).toHaveLength(0);
			await act(async () => {
				radios('import-0')[1]!.click();
			});
			expect(statuses()).toEqual(['Free', 'Free']);
			await typeInto(document.body.querySelector<HTMLInputElement>('input[id^="import-tag-"]')!, '');

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const [action] = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions;
			// The cleared field gives no tag; the other suggestion and the free tag stay.
			expect(action?.item?.persona_tags).toHaveLength(2);
			expect(action?.item?.persona_tags).toContainEqual({prefix: 'ly2:'});
			expect(action?.item?.persona_tags).not.toContainEqual({prefix: 'ly:'});
			expect(action?.item?.persona_tags).not.toContainEqual({prefix: 'lyr:'});
		});
	});

	describe('a member that might be one of your personas', () => {
		const tyne = (id: string, name: string, tags: Array<{prefix: string}>) => ({
			id,
			name,
			persona_tags: tags,
			signature_emojis: [],
			use_count: 4,
			visibility: 'public' as const,
			auto_tag_disabled: false,
			created_at: '2026-09-01T00:00:00.000Z',
			updated_at: '2026-09-01T00:00:00.000Z',
		});
		const file = () =>
			new File(
				[
					JSON.stringify({
						members: [{id: 'lllll', name: 'Lily & Lisica', proxy_tags: [{prefix: 'Lils:'}], privacy: PUBLIC}],
					}),
				],
				'pk.json',
				{type: 'application/json'},
			);
		const toggle = () =>
			document.body.querySelector<HTMLButtonElement>('[data-flx="persona.persona-import-review.cant-tell.toggle"]');
		const radios = (name: string) =>
			Array.from(document.body.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));

		beforeEach(() => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{
						index: 0,
						kind: 'cant_tell',
						candidates: [
							{persona_id: '100000000000000008', matched_on: 'tag', linked_elsewhere: false},
							{persona_id: '100000000000000009', matched_on: 'name', linked_elsewhere: false},
						],
						clashes: [{tag: {prefix: 'Lils:'}, held_by_persona_id: '100000000000000008'}],
					},
				],
				personas: [
					tyne('100000000000000008', 'Lisica & Lily', [{prefix: 'Lils:'}]),
					tyne('100000000000000009', 'Lily & Lisica', [{prefix: 'Li:'}]),
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
		});

		async function openRow(): Promise<void> {
			await act(async () => {
				root.render(
					<PluralKitImportModal onClose={vi.fn()} data-flx="persona.plural-kit-import-modal-test.cant-tell" />,
				);
			});
			await chooseFile(file(), 'Total Members1');
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(toggle()?.textContent).toContain('Lily & Lisica'));
			expect(toggle()?.textContent).toContain('Skipping');
			await act(async () => {
				toggle()!.click();
			});
			expect(document.body.textContent).toContain('Which persona is Lily & Lisica?');
			// Two personas and None of these; nothing picked, so no switch yet.
			expect(radios('import-pick-0')).toHaveLength(3);
			expect(radios('import-0')).toHaveLength(0);
		}

		it("picks a persona, then takes the file's version into it", async () => {
			await openRow();
			await act(async () => {
				radios('import-pick-0')[0]!.click();
			});
			const [useFile, , useTyne] = radios('import-0');
			expect(useTyne?.checked).toBe(true);
			expect(toggle()?.textContent).toContain("Keeping {productName}'s".replace('{productName}', PRODUCT_NAME));
			await act(async () => {
				useFile!.click();
			});
			expect(document.body.textContent).toContain(
				"Replaces {productName}'s {name}".replace('{productName}', PRODUCT_NAME).replace('{name}', 'Lisica & Lily'),
			);

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const request = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0];
			expect(request.actions).toEqual([
				expect.objectContaining({
					action: 'use_file',
					persona_id: '100000000000000008',
					item: expect.objectContaining({name: 'Lily & Lisica', external_uuid: 'lllll'}),
				}),
			]);
			expect(PersonaImportApplyRequestSchema.safeParse(request).success).toBe(true);
		});

		it('says it is none of them, then keeps it as a new persona with a tag of its own', async () => {
			await openRow();
			await act(async () => {
				radios('import-pick-0')[2]!.click();
			});
			const [skip, keep] = radios('import-0');
			expect(skip?.checked).toBe(true);
			await act(async () => {
				keep!.click();
			});
			expect(toggle()?.textContent).toContain('Keeping');
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const [action] = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions;
			expect(action).toMatchObject({action: 'add', item: {external_uuid: 'lllll'}});
			expect(action?.item?.persona_tags).not.toContainEqual({prefix: 'Lils:'});
		});
	});

	describe('a member whose tag is taken', () => {
		beforeEach(() => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{index: 0, kind: 'tag_in_use', clashes: [{tag: {prefix: 'ly:'}, held_by_persona_id: '100000000000000009'}]},
				],
				personas: [
					{
						id: '100000000000000009',
						name: 'Lyra ✦',
						persona_tags: [{prefix: 'ly:'}],
						signature_emojis: [],
						use_count: 88,
						visibility: 'public',
						auto_tag_disabled: false,
						created_at: '2026-09-01T00:00:00.000Z',
						updated_at: '2026-09-01T00:00:00.000Z',
					},
				],
				display_tag: {decision: 'none', current_text: null},
				untouched: 0,
				needs_review: true,
			});
		});

		it('is skipped by default, and kept with the suggested tag or one typed in its place', async () => {
			const file = new File(
				[JSON.stringify({members: [{id: 'ccccc', name: 'Lyra ✧', proxy_tags: [{prefix: 'ly:'}], privacy: PUBLIC}]})],
				'pk.json',
				{type: 'application/json'},
			);
			await act(async () => {
				root.render(
					<PluralKitImportModal onClose={vi.fn()} data-flx="persona.plural-kit-import-modal-test.tag-taken" />,
				);
			});
			await chooseFile(file, 'Total Members1');
			await act(async () => {
				importButton()?.click();
			});
			const toggle = () =>
				document.body.querySelector<HTMLButtonElement>('[data-flx="persona.persona-import-review.taken.toggle"]');
			await settled(() => expect(toggle()?.textContent).toContain('Lyra ✧'));
			expect(toggle()?.textContent).toContain('Skipping');
			await act(async () => {
				toggle()!.click();
			});
			expect(document.body.textContent).toContain('already belongs to your persona Lyra ✦');
			const [skip, keep] = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[name="import-0"]'));
			expect(skip?.checked).toBe(true);
			expect(document.body.querySelector('input[id^="import-tag-"]')).toBeNull();

			// Keep: the name stays (no other persona has it) and the tag field starts on a free one.
			await act(async () => {
				keep!.click();
			});
			expect(toggle()?.textContent).toContain('Keeping');
			expect(document.body.querySelector<HTMLInputElement>('#import-copy-name-0')?.value).toBe('Lyra ✧');
			const field = document.body.querySelector('input[type="text"][id^="import-tag-"]') as HTMLInputElement;
			expect(field.value).toBe('lyr:');
			const type = async (value: string) => {
				await act(async () => {
					const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
					setter.call(field, value);
					field.dispatchEvent(new Event('input', {bubbles: true}));
				});
			};
			await type('ly:');
			expect(document.body.textContent).toContain('Lyra ✦ already has it');
			await type('lyx:');
			expect(document.body.textContent).not.toContain('already has it');

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const [action] = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions;
			// Added as a new persona linked to its member, with the new tag in place of the taken one.
			expect(action).toMatchObject({
				action: 'add',
				item: {name: 'Lyra ✧', persona_tags: [{prefix: 'lyx:'}], external_uuid: 'ccccc'},
			});
			expect(action).not.toHaveProperty('drop_tags');
			// Regression: the whole request passes the API's schema (an empty suffix "" used to fail it).
			expect(
				PersonaImportApplyRequestSchema.safeParse(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0])
					.success,
			).toBe(true);
		});
	});

	describe('around the review', () => {
		const pkFile = (members: Array<Record<string, unknown>>) =>
			new File([JSON.stringify({members: members.map((m) => ({privacy: PUBLIC, ...m}))})], 'pk.json', {
				type: 'application/json',
			});
		const persona = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
			id,
			name,
			persona_tags: [],
			signature_emojis: [],
			use_count: 1,
			visibility: 'public' as const,
			auto_tag_disabled: false,
			created_at: '2026-09-01T00:00:00.000Z',
			updated_at: '2026-09-01T00:00:00.000Z',
			...extra,
		});
		const render = async (onClose = vi.fn()) => {
			await act(async () => {
				root.render(<PluralKitImportModal onClose={onClose} data-flx="persona.plural-kit-import-modal-test.around" />);
			});
			return onClose;
		};
		const dropzone = () =>
			document.body.querySelector<HTMLElement>('[data-flx="persona.plural-kit-import-modal.dropzone.click"]');

		it('reads a file dropped on the drop zone, and opens the file picker from the keyboard', async () => {
			await render();
			const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
			const pick = vi.spyOn(input, 'click').mockImplementation(() => {});
			for (const key of ['Enter', ' ', 'a']) {
				await act(async () => {
					dropzone()!.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
				});
			}
			expect(pick).toHaveBeenCalledTimes(2);
			const drop = new Event('drop', {bubbles: true, cancelable: true});
			Object.defineProperty(drop, 'dataTransfer', {value: {files: [pkFile([{id: 'd1', name: 'Dew'}])]}});
			await act(async () => {
				dropzone()!.dispatchEvent(drop);
			});
			await settled(() => expect(document.body.textContent).toContain('Total Members1'));
			expect(drop.defaultPrevented).toBe(true);
		});

		it('says so when the file cannot be read', async () => {
			await render();
			const broken = new File(['{}'], 'pk.json', {type: 'application/json'});
			const fail = () => Promise.reject(new Error('read error'));
			Object.defineProperty(broken, 'text', {value: fail});
			Object.defineProperty(broken, 'arrayBuffer', {value: fail});
			const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
			await act(async () => {
				Object.defineProperty(input, 'files', {value: [broken], configurable: true});
				input.dispatchEvent(new Event('change', {bubbles: true}));
			});
			await settled(() => expect(document.body.textContent).toContain('Failed to read the selected file.'));
			expect(document.body.textContent).not.toContain('Total Members');
		});

		it('goes back to the file, with a toast, when the comparison fails, and closes at once before a review', async () => {
			const onClose = await render();
			vi.mocked(PersonaCommands.previewPersonaImport).mockRejectedValueOnce(new Error('offline'));
			await chooseFile(pkFile([{id: 'd1', name: 'Dew'}]), 'Total Members1');
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(ToastCommands.error).toHaveBeenCalledTimes(1));
			expect(document.body.textContent).toContain('Total Members1');
			expect(PersonaCommands.applyPersonaImport).not.toHaveBeenCalled();
			// No review is open, so closing asks nothing.
			await act(async () => {
				document.querySelector<HTMLButtonElement>('[data-flx="app.modal.header.button.close"]')?.click();
			});
			expect(onClose).toHaveBeenCalledTimes(1);
			expect(ModalCommands.push).not.toHaveBeenCalled();
		});

		it('goes back to the file, with a toast, when the import is refused after no review', async () => {
			await render();
			vi.mocked(PersonaCommands.applyPersonaImport).mockRejectedValueOnce(new Error('refused'));
			await chooseFile(pkFile([{id: 'd1', name: 'Dew'}]), 'Total Members1');
			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(ToastCommands.error).toHaveBeenCalledTimes(1));
			expect(importButton()).toBeDefined();
			expect(document.body.textContent).not.toContain('Import finished');
		});

		it("shows a zip's own pictures when they could not be stored, and lets them go when the dialog closes", async () => {
			// The failure's reason is translated with the app's i18n, which the app always activates.
			i18n.loadAndActivate({locale: 'en', messages: {}});
			vi.mocked(PersonaCommands.importPersonaImage).mockRejectedValue(new Error('storage down'));
			const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:local-avatar');
			const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
			try {
				PersonaStore.setPersonas([persona('100000000000000101', 'Alvis', {bio: 'Old'})]);
				vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
					entries: [
						{
							index: 0,
							kind: 'differs',
							persona_id: '100000000000000101',
							differences: [{field: 'bio', change: 'changed'}],
						},
					],
					personas: [persona('100000000000000101', 'Alvis', {bio: 'Old'})],
					display_tag: {decision: 'none', current_text: null},
					untouched: 0,
					needs_review: true,
				});
				const encoder = new TextEncoder();
				const zip = zipSync({
					'pluralkit.json': encoder.encode(
						JSON.stringify({
							version: 2,
							members: [{id: '1428573920012345679', name: 'Alvis', description: 'New', privacy: PUBLIC}],
						}),
					),
					'tyne.json': encoder.encode(
						JSON.stringify({
							format: 'tyne-personas',
							version: 1,
							pluralkit_file: 'pluralkit.json',
							members: {'1428573920012345679': {avatar: 'avatars/Alvis.png'}},
						}),
					),
					'avatars/Alvis.png': PNG,
				});
				await render();
				await chooseFile(new File([zip as BlobPart], 'Tyne personas.zip', {type: 'application/zip'}), 'Total Members1');
				await act(async () => {
					importButton()?.click();
				});
				await act(async () => {
					Array.from(document.body.querySelectorAll('button'))
						.find((b) => b.textContent?.trim() === 'Skip')
						?.click();
				});
				await settled(() => expect(differsToggle('Alvis')).toBeDefined());
				// The row and, opened, the file's card show the zip's picture.
				expect(created).toHaveBeenCalledWith(expect.objectContaining({type: 'image/png'}));
				await act(async () => {
					differsToggle('Alvis')!.click();
				});
				const pictures = Array.from(document.body.querySelectorAll<HTMLImageElement>('img')).map((img) =>
					img.getAttribute('src'),
				);
				expect(pictures).toContain('blob:local-avatar');
				act(() => {
					root.unmount();
				});
				expect(revoked).toHaveBeenCalledWith('blob:local-avatar');
				root = createRoot(container);
			} finally {
				created.mockRestore();
				revoked.mockRestore();
				vi.mocked(PersonaCommands.importPersonaImage).mockReset();
			}
		});
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

	// The collapsed row of a persona that differs from the file.
	function differsToggle(name: string): HTMLButtonElement | undefined {
		return Array.from(
			document.body.querySelectorAll<HTMLButtonElement>('[data-flx="persona.persona-import-review.differs.toggle"]'),
		).find((button) => button.textContent?.includes(name));
	}

	function differsBody(): HTMLElement | null {
		return document.body.querySelector('[data-flx="persona.persona-import-review.differs.body"]');
	}

	function importButton(): HTMLButtonElement | undefined {
		return Array.from(document.body.querySelectorAll('button')).find((btn) => btn.textContent?.trim() === 'Import');
	}

	// Presses Import on a file with nothing to decide and waits for the result.
	async function startImport(): Promise<void> {
		await act(async () => {
			importButton()?.click();
		});
		await settled(() => expect(document.body.textContent).toContain('personas added'));
	}

	// The personas the import added, from the actions it sent.
	function appliedItems(): Array<unknown> {
		const request = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls.at(-1)?.[0];
		return (request?.actions ?? []).map((action) => action.item);
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
			expect(appliedItems()).toEqual([
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
			expect(document.body.querySelectorAll('input[type="text"]').length).toBe(0);

			await startImport();

			expect(fetchSpy).not.toHaveBeenCalled();
			expect(PersonaCommands.importPersonaImage).toHaveBeenCalledWith(
				'avatar',
				expect.stringMatching(/^data:image\/png;base64,/),
			);
			expect(vi.mocked(PersonaCommands.previewPersonaImport).mock.calls[0]?.[0].display_tag).toEqual({
				text: 'T'.repeat(90),
				has_icon: false,
			});
			expect(appliedItems()).toEqual([
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

	describe("a Tyne export's tag icon", () => {
		// A one-persona Tyne export whose tyne.json carries `tagIcon`.
		function tyneZipWithTagIcon(tagIcon: Record<string, string>, files: Record<string, Uint8Array> = {}): File {
			const encoder = new TextEncoder();
			const pluralKit = {
				version: 2,
				tag: 'SYS',
				members: [{id: 'aaaaa', name: 'Alvis', proxy_tags: [], privacy: PUBLIC}],
				groups: [],
				switches: [],
			};
			const manifest = {
				format: 'tyne-personas',
				version: 1,
				pluralkit_file: 'pluralkit.json',
				members: {},
				...tagIcon,
			};
			const zip = zipSync({
				'pluralkit.json': encoder.encode(JSON.stringify(pluralKit)),
				'tyne.json': encoder.encode(JSON.stringify(manifest)),
				...files,
			});
			return new File([zip as BlobPart], 'Tyne personas.zip', {type: 'application/zip'});
		}

		async function importZip(file: File): Promise<void> {
			await act(async () => {
				root.render(
					<PluralKitImportModal
						onClose={vi.fn()}
						data-flx="persona.plural-kit-import-modal-test.plural-kit-import-modal--8"
					/>,
				);
			});
			await chooseFile(file, 'Total Members1');
			await startImport();
		}

		it('stores the icon file from the zip and sets its hash', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
			try {
				await importZip(tyneZipWithTagIcon({tag_icon: 'Tag icon.png'}, {'Tag icon.png': PNG}));

				expect(fetchSpy).not.toHaveBeenCalled();
				expect(PersonaCommands.importPersonaImage).toHaveBeenCalledWith(
					'avatar',
					expect.stringMatching(/^data:image\/png;base64,/),
				);
				expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('SYS', 'aaaaaaaa');
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it('has the server download a linked icon, once, and sets the stored copy, never the link', async () => {
			const url = 'https://images.example/tag.png';
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				const results = {[url]: {avatar_hash: 'dddddddd'}};
				return new Response(`${JSON.stringify({type: 'complete', total: 1, results})}\n`, {status: 200});
			});
			try {
				await importZip(tyneZipWithTagIcon({tag_icon_url: url}));

				expect(fetchSpy).toHaveBeenCalledTimes(1);
				expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({urls: [url], kind: 'avatar'});
				expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('SYS', 'dddddddd');
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it('keeps the current icon and warns when the download fails', async () => {
			const url = 'https://images.example/tag.png';
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				const results = {[url]: {error: 'Could not import an avatar from this URL'}};
				return new Response(`${JSON.stringify({type: 'complete', total: 1, results})}\n`, {status: 200});
			});
			try {
				await importZip(tyneZipWithTagIcon({tag_icon_url: url}));

				expect(fetchSpy).toHaveBeenCalledTimes(1);
				expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('SYS', undefined);
				expect(document.body.textContent).toContain('Tag Icon');
				expect(document.body.textContent).not.toContain('Prefix:');
				expect(document.body.textContent).toContain(
					'The tag icon could not be stored: Could not import an avatar from this URL.',
				);
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it('keeps the current icon and warns when the server refuses the batch', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockImplementation(async () => new Response('{"message":"Too many"}', {status: 429}));
			try {
				await importZip(tyneZipWithTagIcon({tag_icon_url: 'https://images.example/tag.png'}));

				expect(fetchSpy).toHaveBeenCalledTimes(1);
				expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('SYS', undefined);
				// The reason for a refused batch is formatted with the app's own i18n, which this test does not
				// set up, so only the warning itself is checked.
				expect(document.body.textContent).toContain('The tag icon could not be stored: ');
				expect(document.body.textContent).toContain('It can be set again in the persona settings.');
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it('ignores a link that is not a web address', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
			try {
				await importZip(tyneZipWithTagIcon({tag_icon_url: 'data:image/png;base64,iVBORw0KGgo='}));

				expect(fetchSpy).not.toHaveBeenCalled();
				expect(PersonaStore.setDisplayTag).toHaveBeenCalledWith('SYS', undefined);
			} finally {
				fetchSpy.mockRestore();
			}
		});
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
