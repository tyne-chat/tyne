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

vi.mock('framer-motion', async () => {
	const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
	return {
		...actual,
		motion: {
			div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
				<div ref={ref} data-flx="persona.persona-edit-modal-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="persona.persona-edit-modal-test.span" {...props} />
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

const mockCurrentUser = {
	id: '100000000000000001',
	username: 'alice',
	discriminator: '0001',
	avatar: null,
	avatarColor: 1,
	flags: 0,
};

vi.mock('@app/features/user/state/Users', () => ({
	default: {
		getCurrentUser: vi.fn(() => mockCurrentUser),
		get currentUser() {
			return mockCurrentUser;
		},
	},
}));

vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	createPersona: vi.fn().mockResolvedValue({id: '100000000000000099', name: 'New Persona'}),
	updatePersona: vi.fn().mockResolvedValue(undefined),
	deletePersona: vi.fn().mockResolvedValue(undefined),
	uploadPersonaImage: vi.fn(),
	personaErrorMessage: vi.fn((_err: unknown, fallback: string) => fallback),
}));

// Upstream's uploaders open a file picker and a cropper; these hand the editor a picked image directly.
vi.mock('@app/features/user/components/modals/tabs/my_profile_tab/AvatarUploader', () => ({
	AvatarUploader: ({onAvatarChange}: {onAvatarChange: (base64: string) => void}) => (
		<button
			type="button"
			onClick={() => onAvatarChange('data:image/png;base64,AVATAR')}
			data-flx="persona.persona-edit-modal-test.pick-avatar"
		/>
	),
}));
vi.mock('@app/features/user/components/modals/tabs/my_profile_tab/BannerUploader', () => ({
	BannerUploader: ({onBannerChange}: {onBannerChange: (base64: string) => void}) => (
		<button
			type="button"
			onClick={() => onBannerChange('data:image/png;base64,BANNER')}
			data-flx="persona.persona-edit-modal-test.pick-banner"
		/>
	),
}));

vi.mock('@app/features/ui/commands/ToastCommands', () => ({
	createToast: vi.fn(),
}));

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: vi.fn((modalFn) => (typeof modalFn === 'function' ? modalFn() : modalFn)),
	pushWithKey: vi.fn(),
	popWithKey: vi.fn(),
	modal: vi.fn((fn) => fn),
}));

vi.mock('@app/features/user/utils/NicknameUtils', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getNickname: vi.fn((user: {username: string}) => user.username),
		formatNicknameForStreamerMode: vi.fn((nick: string) => nick),
		formatTagForStreamerMode: vi.fn((tag: string) => tag),
	};
});

vi.mock('@app/features/messaging/components/markdown', () => ({
	SafeMarkdown: ({content}: {content?: string}) => (
		<div data-testid="markdown" data-flx="persona.persona-edit-modal-test.safe-markdown.markdown">
			{content}
		</div>
	),
}));

import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {PersonaEditModal} from '@app/features/persona/components/modals/PersonaEditModal';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';

describe('PersonaEditModal Component', () => {
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
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = '';
	});

	it('renders in create mode with empty form and creates a persona upon submit', async () => {
		const onClose = vi.fn();

		await act(async () => {
			root.render(<PersonaEditModal onClose={onClose} data-flx="persona.persona-edit-modal-test.persona-edit-modal" />);
		});

		expect(document.body.textContent).toContain('New Persona');
		// Delete button should not exist in create mode
		expect(document.body.querySelector('[aria-label="Delete persona"]')).toBeNull();

		const nameInput = document.body.querySelector(
			'[data-flx="persona.persona-edit-modal.input.name"]',
		) as HTMLInputElement;
		expect(nameInput).not.toBeNull();

		// Type persona name
		await act(async () => {
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
			nativeInputValueSetter?.call(nameInput, 'Sparkle');
			nameInput.dispatchEvent(new Event('input', {bubbles: true}));
		});

		// Unsaved changes banner should now be visible with save button
		const saveButton = document.body.querySelector(
			'[data-flx="persona.persona-edit-modal.button.save"]',
		) as HTMLButtonElement | null;
		expect(saveButton).not.toBeNull();

		await act(async () => {
			saveButton?.click();
		});

		expect(PersonaCommands.createPersona).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Sparkle',
				visibility: 'unlisted',
			}),
		);
		expect(ToastCommands.createToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'success',
			}),
		);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('renders in edit mode, prepopulates data, and updates persona upon submit', async () => {
		const onClose = vi.fn();
		const existingPersona = {
			id: '100000000000000088',
			name: 'Existing Persona',
			pronouns: 'they/them',
			bio: 'Existing bio description',
			visibility: 'public' as const,
			persona_tags: [{prefix: '<', suffix: '>'}],
		} as any;

		runInAction(() => {
			PersonaStore.setPersonas([existingPersona]);
		});

		await act(async () => {
			root.render(
				<PersonaEditModal
					persona={existingPersona}
					onClose={onClose}
					data-flx="persona.persona-edit-modal-test.persona-edit-modal--2"
				/>,
			);
		});

		expect(document.body.textContent).toContain('Existing Persona');

		// Delete button should exist in edit mode
		const deleteBtn = document.body.querySelector('[aria-label="Delete persona"]') as HTMLButtonElement | null;
		expect(deleteBtn).not.toBeNull();

		// Change pronouns
		const pronounsInput = document.body.querySelector(
			'[data-flx="persona.persona-edit-modal.input.pronouns"]',
		) as HTMLInputElement;
		expect(pronounsInput).not.toBeNull();
		expect(pronounsInput.value).toBe('they/them');

		await act(async () => {
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
			nativeInputValueSetter?.call(pronounsInput, 'she/her');
			pronounsInput.dispatchEvent(new Event('input', {bubbles: true}));
		});

		const saveButton = document.body.querySelector(
			'[data-flx="persona.persona-edit-modal.button.save"]',
		) as HTMLButtonElement | null;
		expect(saveButton).not.toBeNull();

		await act(async () => {
			saveButton?.click();
		});

		expect(PersonaCommands.updatePersona).toHaveBeenCalledWith(
			existingPersona.id,
			expect.objectContaining({
				name: 'Existing Persona',
				pronouns: 'she/her',
				visibility: 'public',
			}),
		);
		expect(ToastCommands.createToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'success',
			}),
		);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("saves the switch for not matching the persona's tags", async () => {
		const existingPersona = {id: '100000000000000088', name: 'Existing Persona', auto_tag_disabled: false} as any;
		runInAction(() => {
			PersonaStore.setPersonas([existingPersona]);
		});
		await act(async () => {
			root.render(
				<PersonaEditModal
					persona={existingPersona}
					onClose={vi.fn()}
					data-flx="persona.persona-edit-modal-test.persona-edit-modal--auto-tag"
				/>,
			);
		});
		const saveButton = () =>
			document.body.querySelector('[data-flx="persona.persona-edit-modal.button.save"]') as HTMLButtonElement | null;
		expect(saveButton()).toBeNull();

		const toggle = document.body.querySelector('[role="switch"]') as HTMLElement;
		expect(toggle.getAttribute('aria-checked')).toBe('false');
		await act(async () => {
			toggle.click();
		});
		await act(async () => {
			saveButton()?.click();
		});

		expect(PersonaCommands.updatePersona).toHaveBeenCalledWith(
			existingPersona.id,
			expect.objectContaining({auto_tag_disabled: true}),
		);
	});

	it('shows the saved value of the switch and can turn it off', async () => {
		const existingPersona = {id: '100000000000000088', name: 'Existing Persona', auto_tag_disabled: true} as any;
		runInAction(() => {
			PersonaStore.setPersonas([existingPersona]);
		});
		await act(async () => {
			root.render(
				<PersonaEditModal
					persona={existingPersona}
					onClose={vi.fn()}
					data-flx="persona.persona-edit-modal-test.persona-edit-modal--auto-tag-on"
				/>,
			);
		});
		const toggle = document.body.querySelector('[role="switch"]') as HTMLElement;
		expect(toggle.getAttribute('aria-checked')).toBe('true');
		await act(async () => {
			toggle.click();
		});
		await act(async () => {
			(document.body.querySelector('[data-flx="persona.persona-edit-modal.button.save"]') as HTMLButtonElement).click();
		});

		expect(PersonaCommands.updatePersona).toHaveBeenCalledWith(
			existingPersona.id,
			expect.objectContaining({auto_tag_disabled: false}),
		);
	});

	it('resets form data when reset button is clicked', async () => {
		const onClose = vi.fn();
		const existingPersona = {
			id: '100000000000000088',
			name: 'Existing Persona',
			pronouns: 'they/them',
		} as any;

		await act(async () => {
			root.render(
				<PersonaEditModal
					persona={existingPersona}
					onClose={onClose}
					data-flx="persona.persona-edit-modal-test.persona-edit-modal--3"
				/>,
			);
		});

		const pronounsInput = document.body.querySelector(
			'[data-flx="persona.persona-edit-modal.input.pronouns"]',
		) as HTMLInputElement;
		expect(pronounsInput).not.toBeNull();

		await act(async () => {
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
			nativeInputValueSetter?.call(pronounsInput, 'he/him');
			pronounsInput.dispatchEvent(new Event('input', {bubbles: true}));
		});

		expect(pronounsInput.value).toBe('he/him');

		const resetBtn = document.body.querySelector(
			'[data-flx="persona.persona-edit-modal.button.reset"]',
		) as HTMLButtonElement | null;
		expect(resetBtn).not.toBeNull();

		await act(async () => {
			resetBtn?.click();
		});

		expect(pronounsInput.value).toBe('they/them');
	});

	it('handles delete persona confirmation and deletion', async () => {
		const onClose = vi.fn();
		const existingPersona = {
			id: '100000000000000088',
			name: 'Persona to Delete',
		} as any;

		await act(async () => {
			root.render(
				<PersonaEditModal
					persona={existingPersona}
					onClose={onClose}
					data-flx="persona.persona-edit-modal-test.persona-edit-modal--4"
				/>,
			);
		});

		const deleteBtn = document.body.querySelector('[aria-label="Delete persona"]') as HTMLButtonElement | null;
		expect(deleteBtn).not.toBeNull();

		await act(async () => {
			deleteBtn?.click();
		});

		// ModalCommands.push should have been called with confirmation modal
		expect(ModalCommands.push).toHaveBeenCalledTimes(1);
	});

	it('renders signature emoji chips from existing persona and allows removal', async () => {
		const onClose = vi.fn();
		const existingPersona = {
			id: '100000000000000099',
			name: 'Fox Persona',
			signature_emojis: [{name: '🦊'}, {name: '⭐'}],
		} as any;

		await act(async () => {
			root.render(
				<PersonaEditModal
					persona={existingPersona}
					onClose={onClose}
					data-flx="persona.persona-edit-modal-test.persona-edit-modal--5"
				/>,
			);
		});

		// Verify signature emoji chips are rendered
		expect(document.body.textContent).toContain('🦊');
		expect(document.body.textContent).toContain('⭐');

		const removeBtns = document.body.querySelectorAll('[aria-label="Remove signature emoji"]');
		expect(removeBtns.length).toBe(2);

		// Remove the first emoji (🦊)
		await act(async () => {
			(removeBtns[0] as HTMLElement).click();
		});

		// Only ⭐ should remain
		const remainingRemoveBtns = document.body.querySelectorAll('[aria-label="Remove signature emoji"]');
		expect(remainingRemoveBtns.length).toBe(1);
	});

	// Prefix 'a:::' with suffix 'b' and prefix 'a' with suffix ':::b' are different tags; the check once
	// joined them with ':::' and saw the same key.
	it('does not take tags containing the old separator for duplicates', async () => {
		await act(async () => {
			root.render(
				<PersonaEditModal onClose={vi.fn()} data-flx="persona.persona-edit-modal-test.persona-edit-modal--colons" />,
			);
		});
		const type = async (input: HTMLInputElement, value: string) => {
			await act(async () => {
				Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
				input.dispatchEvent(new Event('input', {bubbles: true}));
			});
		};
		const click = async (flx: string) => {
			await act(async () => {
				(document.body.querySelector(`[data-flx="${flx}"]`) as HTMLButtonElement).click();
			});
		};
		const prefixes = () =>
			document.body.querySelectorAll<HTMLInputElement>(
				'[data-flx="persona.persona-edit-modal.tag-input.tag-change.text"]',
			);
		const suffixes = () =>
			document.body.querySelectorAll<HTMLInputElement>(
				'[data-flx="persona.persona-edit-modal.tag-input.tag-change.text--2"]',
			);

		await type(document.body.querySelector('[data-flx="persona.persona-edit-modal.input.name"]')!, 'Colons');
		await type(prefixes()[0], 'a:::');
		await type(suffixes()[0], 'b');
		await click('persona.persona-edit-modal.button.add-tag-row');
		await type(prefixes()[1], 'a');
		await type(suffixes()[1], ':::b');
		await click('persona.persona-edit-modal.button.save');

		expect(PersonaCommands.createPersona).toHaveBeenCalledWith(
			expect.objectContaining({
				persona_tags: [
					{prefix: 'a:::', suffix: 'b'},
					{prefix: 'a', suffix: ':::b'},
				],
			}),
		);
	});

	// Like upstream's profile fields, each input stops at the server's limit (tyne#160, M4-12).
	it('limits proxy tag prefixes and suffixes to 32 characters', async () => {
		await act(async () => {
			root.render(
				<PersonaEditModal
					onClose={vi.fn()}
					data-flx="persona.persona-edit-modal-test.persona-edit-modal--tag-limits"
				/>,
			);
		});

		for (const flx of [
			'persona.persona-edit-modal.tag-input.tag-change.text',
			'persona.persona-edit-modal.tag-input.tag-change.text--2',
		]) {
			const input = document.body.querySelector(`[data-flx="${flx}"]`) as HTMLInputElement | null;
			expect(input).not.toBeNull();
			expect(input?.maxLength).toBe(32);
		}
	});

	// Like upstream's profile editor, a picked image is only uploaded on Save (tyne#160, M4-6).
	describe('picked images', () => {
		const existingPersona = {id: '100000000000000088', name: 'Existing Persona', pronouns: 'they/them'} as any;
		const click = async (flx: string) => {
			const el = document.body.querySelector(`[data-flx="${flx}"]`) as HTMLButtonElement | null;
			expect(el).not.toBeNull();
			await act(async () => {
				el?.click();
			});
		};
		const render = async (onClose = vi.fn()) => {
			await act(async () => {
				root.render(
					<PersonaEditModal
						persona={existingPersona}
						onClose={onClose}
						data-flx="persona.persona-edit-modal-test.persona-edit-modal--images"
					/>,
				);
			});
			return onClose;
		};

		it('uploads a picked avatar only on Save, then saves its hash', async () => {
			vi.mocked(PersonaCommands.uploadPersonaImage).mockResolvedValue({hash: 'avatarhash', avatarColor: 0x123456});
			const onClose = await render();

			await click('persona.persona-edit-modal-test.pick-avatar');
			expect(PersonaCommands.uploadPersonaImage).not.toHaveBeenCalled();

			await click('persona.persona-edit-modal.button.save');

			expect(PersonaCommands.uploadPersonaImage).toHaveBeenCalledTimes(1);
			expect(PersonaCommands.uploadPersonaImage).toHaveBeenCalledWith('avatar', 'data:image/png;base64,AVATAR');
			expect(PersonaCommands.updatePersona).toHaveBeenCalledWith(
				existingPersona.id,
				expect.objectContaining({avatar_hash: 'avatarhash', avatar_color: 0x123456}),
			);
			expect(onClose).toHaveBeenCalledTimes(1);
		});

		it('drops a picked image on Reset without uploading it', async () => {
			await render();

			await click('persona.persona-edit-modal-test.pick-banner');
			await click('persona.persona-edit-modal.button.reset');

			expect(document.body.querySelector('[data-flx="persona.persona-edit-modal.button.reset"]')).toBeNull();
			expect(PersonaCommands.uploadPersonaImage).not.toHaveBeenCalled();
		});

		it('saves nothing when an upload fails, and does not upload a stored image again', async () => {
			let bannerAttempts = 0;
			vi.mocked(PersonaCommands.uploadPersonaImage).mockImplementation(async (kind) => {
				if (kind === 'avatar') return {hash: 'avatarhash', avatarColor: null};
				bannerAttempts++;
				if (bannerAttempts === 1) throw new Error('offline');
				return {hash: 'bannerhash', avatarColor: null};
			});
			const onClose = await render();
			await click('persona.persona-edit-modal-test.pick-avatar');
			await click('persona.persona-edit-modal-test.pick-banner');

			await click('persona.persona-edit-modal.button.save');

			expect(PersonaCommands.updatePersona).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
			expect(ToastCommands.createToast).toHaveBeenCalledWith(expect.objectContaining({type: 'error'}));

			await click('persona.persona-edit-modal.button.save');

			expect(vi.mocked(PersonaCommands.uploadPersonaImage).mock.calls.map(([kind]) => kind)).toEqual([
				'avatar',
				'banner',
				'banner',
			]);
			expect(PersonaCommands.updatePersona).toHaveBeenCalledTimes(1);
			expect(PersonaCommands.updatePersona).toHaveBeenCalledWith(
				existingPersona.id,
				expect.objectContaining({avatar_hash: 'avatarhash', banner_hash: 'bannerhash'}),
			);
			expect(onClose).toHaveBeenCalledTimes(1);
		});
	});

	describe('duplicating a persona (tyne-chat/tyne#599)', () => {
		const lyra = {
			id: '100000000000000077',
			name: 'Lyra',
			pronouns: 'she/they',
			bio: 'Night owl, stargazer.',
			visibility: 'public' as const,
			avatar_hash: '0a1b2c3d',
			avatar_color: 0x26225e,
			banner_hash: 'a_4e5f6a7b',
			color: 0x7b6cf6,
			auto_tag_disabled: true,
			persona_tags: [{prefix: 'Ly:'}, {prefix: '[', suffix: ']'}],
			signature_emojis: [{id: null, name: '🌙', animated: null}],
		} as any;
		const query = (flx: string) => document.body.querySelector(`[data-flx="${flx}"]`) as HTMLElement | null;
		const click = async (flx: string) => {
			await act(async () => {
				query(flx)?.click();
			});
		};
		const renderCopy = async (onClose = vi.fn()) => {
			await act(async () => {
				root.render(
					<PersonaEditModal
						copyOf={lyra}
						onClose={onClose}
						data-flx="persona.persona-edit-modal-test.persona-edit-modal--copy"
					/>,
				);
			});
			return onClose;
		};

		beforeEach(() => {
			runInAction(() => {
				PersonaStore.setPersonas([lyra, {id: '100000000000000078', name: 'Lyra (2)'} as any]);
			});
		});

		it('starts as a copy under the next free number, with no tags or signature emojis', async () => {
			await renderCopy();

			expect(query('persona.persona-edit-modal.copy-banner-text')?.textContent).toBe('Copy of Lyra');
			expect((query('persona.persona-edit-modal.input.name') as HTMLInputElement).value).toBe('Lyra (3)');
			expect((query('persona.persona-edit-modal.input.pronouns') as HTMLInputElement).value).toBe('she/they');
			expect(
				document.body.querySelectorAll('[data-flx="persona.persona-edit-modal.tag-input.tag-change.text"]'),
			).toHaveLength(1);
			expect((query('persona.persona-edit-modal.tag-input.tag-change.text') as HTMLInputElement).value).toBe('');
			expect(query('persona.persona-edit-modal.signature-emoji-chip.signature-emoji-chip')).toBeNull();
			// Neither the edit's bar nor its actions on the saved persona.
			expect(query('persona.persona-edit-modal.button.save')).toBeNull();
			expect(query('persona.persona-edit-modal.button.duplicate-persona')).toBeNull();
			expect(document.body.querySelector('[aria-label="Delete persona"]')).toBeNull();
		});

		it('opens on the name, selected, so typing replaces it', async () => {
			await renderCopy();
			const nameInput = query('persona.persona-edit-modal.input.name') as HTMLInputElement;

			await vi.waitFor(() => expect(document.activeElement).toBe(nameInput));
			expect([nameInput.selectionStart, nameInput.selectionEnd]).toEqual([0, 'Lyra (3)'.length]);
		});

		it('creates the copy in one request, with the same pictures and nothing uploaded', async () => {
			const onClose = await renderCopy();

			await click('persona.persona-edit-modal.button.create-copy');

			expect(PersonaCommands.uploadPersonaImage).not.toHaveBeenCalled();
			expect(PersonaCommands.createPersona).toHaveBeenCalledTimes(1);
			expect(PersonaCommands.createPersona).toHaveBeenCalledWith({
				name: 'Lyra (3)',
				pronouns: 'she/they',
				avatar_hash: '0a1b2c3d',
				avatar_color: 0x26225e,
				banner_hash: 'a_4e5f6a7b',
				color: 0x7b6cf6,
				bio: 'Night owl, stargazer.',
				visibility: 'public',
				persona_tags: [],
				auto_tag_disabled: true,
				signature_emojis: [],
			});
			expect(PersonaCommands.updatePersona).not.toHaveBeenCalled();
			expect(onClose).toHaveBeenCalledTimes(1);
		});

		it('stays open, with the form as it was, when the request fails', async () => {
			vi.mocked(PersonaCommands.createPersona).mockRejectedValueOnce(new Error('limit'));
			const onClose = await renderCopy();

			await click('persona.persona-edit-modal.button.create-copy');

			expect(PersonaCommands.createPersona).toHaveBeenCalledTimes(1);
			expect(ToastCommands.createToast).toHaveBeenCalledWith(expect.objectContaining({type: 'error'}));
			expect(onClose).not.toHaveBeenCalled();
			expect((query('persona.persona-edit-modal.input.name') as HTMLInputElement).value).toBe('Lyra (3)');
		});

		it('Cancel closes without a request', async () => {
			const onClose = await renderCopy();

			await click('persona.persona-edit-modal.button.cancel-copy');

			expect(onClose).toHaveBeenCalledTimes(1);
			expect(PersonaCommands.createPersona).not.toHaveBeenCalled();
		});

		it("Duplicate in a persona's editor closes it and opens the copy of the saved persona", async () => {
			await act(async () => {
				root.render(
					<PersonaEditModal
						persona={lyra}
						onClose={vi.fn()}
						data-flx="persona.persona-edit-modal-test.persona-edit-modal--duplicate"
					/>,
				);
			});

			await click('persona.persona-edit-modal.button.duplicate-persona');

			expect(ModalCommands.popWithKey).toHaveBeenCalledWith('persona-edit-modal');
			expect(ModalCommands.pushWithKey).toHaveBeenCalledTimes(1);
			const [render, key] = vi.mocked(ModalCommands.pushWithKey).mock.calls[0]!;
			expect(key).toBe('persona-copy-modal');
			const copy = (render as unknown as () => React.ReactElement<{copyOf: unknown}>)();
			expect(copy.props.copyOf).toMatchObject({id: lyra.id, name: 'Lyra', avatar_hash: '0a1b2c3d'});
			expect(PersonaCommands.createPersona).not.toHaveBeenCalled();
		});

		it('Duplicate does nothing while the persona has unsaved changes', async () => {
			await act(async () => {
				root.render(
					<PersonaEditModal
						persona={lyra}
						onClose={vi.fn()}
						data-flx="persona.persona-edit-modal-test.persona-edit-modal--duplicate-dirty"
					/>,
				);
			});
			const pronounsInput = query('persona.persona-edit-modal.input.pronouns') as HTMLInputElement;
			await act(async () => {
				Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
					pronounsInput,
					'she/her',
				);
				pronounsInput.dispatchEvent(new Event('input', {bubbles: true}));
			});

			await click('persona.persona-edit-modal.button.duplicate-persona');

			expect(ModalCommands.popWithKey).not.toHaveBeenCalled();
			expect(ModalCommands.pushWithKey).not.toHaveBeenCalled();
			expect(query('persona.persona-edit-modal.button.save')).not.toBeNull();
		});
	});
});
