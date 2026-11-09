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
	getTopModalKey: vi.fn(() => 'import-modal-key'),
	popWithKey: vi.fn(),
}));

import {PRODUCT_NAME} from '@app/features/app/config/ProductConstants';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {PluralKitImportModal} from '@app/features/persona/components/modals/PluralKitImportModal';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {PersonaImportApplyRequestSchema} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
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

		beforeEach(() => {
			vi.mocked(PersonaCommands.previewPersonaImport).mockResolvedValueOnce({
				entries: [
					{
						index: 0,
						kind: 'differs',
						persona_id: '100000000000000001',
						differences: [{field: 'bio', change: 'changed'}],
					},
					{index: 1, kind: 'new'},
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
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(PersonaCommands.applyPersonaImport).not.toHaveBeenCalled();
		}

		it('opens with the safest choices and applies only what they say, storing only the pictures needed', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as {urls: Array<string>};
				const results = Object.fromEntries(body.urls.map((url) => [url, {avatar_hash: 'eeeeeeee'}]));
				return new Response(`${JSON.stringify({type: 'complete', total: body.urls.length, results})}\n`, {status: 200});
			});
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

				// Sun keeps its own details (no action); only Earth is added, with only its picture fetched.
				expect(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]?.[0].actions).toEqual([
					{action: 'add', item: expect.objectContaining({name: 'Earth', avatar_hash: 'eeeeeeee'})},
				]);
				expect(fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
					{urls: ['https://cdn.example/earth.png'], kind: 'avatar'},
				]);
			} finally {
				fetchSpy.mockRestore();
			}
		});

		it("opens a differing persona to compare, and takes the file's version when chosen", async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as {urls: Array<string>};
				const results = Object.fromEntries(body.urls.map((url) => [url, {avatar_hash: 'eeeeeeee'}]));
				return new Response(`${JSON.stringify({type: 'complete', total: body.urls.length, results})}\n`, {status: 200});
			});
			try {
				await openReview(fetchSpy);
				await act(async () => {
					differsToggle('Sun')!.click();
				});
				expect(differsToggle('Sun')!.getAttribute('aria-expanded')).toBe('true');
				expect(differsBody()?.getAttribute('aria-label')).toContain('Sun is different in your file');
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

		it('asks before closing the review, and closes only this dialog when told to stop', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
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

		it('stays on the review when the import is refused', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as {urls: Array<string>};
				const results = Object.fromEntries(body.urls.map((url) => [url, {avatar_hash: 'eeeeeeee'}]));
				return new Response(`${JSON.stringify({type: 'complete', total: body.urls.length, results})}\n`, {status: 200});
			});
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

		it('is left out by default, and added with the suggested tag or one typed in its place', async () => {
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
			await settled(() => expect(document.body.textContent).toContain("Lyra ✧'s tag is already taken"));
			const field = document.body.querySelector('input[type="text"][id^="import-tag-"]') as HTMLInputElement;
			expect(field.value).toBe('lyr:');
			const [leaveOut, addOwn] = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[name="import-0"]'));
			expect(leaveOut?.checked).toBe(true);
			expect(addOwn?.checked).toBe(false);

			// Typing a tag picks "add with a tag of its own"; a taken one is flagged.
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
			expect(addOwn?.checked).toBe(true);

			await act(async () => {
				importButton()?.click();
			});
			await settled(() => expect(PersonaCommands.applyPersonaImport).toHaveBeenCalledTimes(1));
			const [action] = vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0].actions;
			expect(action).toMatchObject({
				action: 'add',
				item: {name: 'Lyra ✧', persona_tags: [{prefix: 'lyx:'}]},
			});
			expect(action).not.toHaveProperty('drop_tags');
			// Regression: the whole request passes the API's schema (an empty suffix "" used to fail it).
			expect(
				PersonaImportApplyRequestSchema.safeParse(vi.mocked(PersonaCommands.applyPersonaImport).mock.calls[0]![0])
					.success,
			).toBe(true);
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
