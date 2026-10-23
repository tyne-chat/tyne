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
});
