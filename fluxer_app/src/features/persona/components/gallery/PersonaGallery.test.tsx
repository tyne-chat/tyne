// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

let mockCurrentUserId = '100000000000000001';
const mockDirectory = vi.hoisted(() => ({
	get: vi.fn(),
	ensure: vi.fn(),
	retry: vi.fn(),
	forget: vi.fn(),
	revision: vi.fn(() => 0),
}));

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) =>
				(descriptor.message ?? '').replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? `{${key}}`)),
			locale: 'en',
		},
	}),
}));
vi.mock('@app/features/auth/state/Authentication', () => ({
	default: {
		get currentUserId() {
			return mockCurrentUserId;
		},
	},
}));
vi.mock('@app/features/persona/state/PersonaDirectory', () => ({PersonaDirectory: mockDirectory}));
vi.mock('@app/features/persona/commands/PersonaCommands', () => ({fetchPersonaProfile: vi.fn()}));
vi.mock('@app/features/channel/commands/PrivateChannelCommands', () => ({
	openDMChannel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({push: vi.fn(), modal: vi.fn((fn) => fn), pop: vi.fn()}));
vi.mock('@app/features/ui/commands/ContextMenuCommands', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/ui/commands/ContextMenuCommands')>()),
	openFromEvent: vi.fn(),
}));
vi.mock('@app/features/messaging/components/markdown', () => ({
	SafeMarkdown: ({content}: {content?: string}) => <div data-flx="persona.gallery-test.safe-markdown">{content}</div>,
}));

import {PersonaGallery} from '@app/features/persona/components/gallery/PersonaGallery';
import {PersonaGalleryNav} from '@app/features/persona/state/PersonaGalleryNav';
import {PersonaGalleryPrefs} from '@app/features/persona/state/PersonaGalleryPrefs';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {User} from '@app/features/user/models/User';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const owner = new User({
	id: '100000000000000001',
	username: 'lantern',
	discriminator: '0001',
	avatar: null,
	flags: 0,
} as any);
const other = new User({
	id: '100000000000000002',
	username: 'bob',
	discriminator: '0002',
	avatar: null,
	flags: 0,
} as any);

const names = (container: HTMLElement, selector: string) =>
	Array.from(container.querySelectorAll(selector)).map((el) => el.textContent);

describe('PersonaGallery', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
		mockCurrentUserId = owner.id;
		runInAction(() => {
			PersonaStore.reset();
			PersonaGalleryPrefs.setView('gallery');
		});
		mockDirectory.get.mockReturnValue({
			status: 'ready',
			list: {
				display_tag_text: 'LANTERN',
				display_tag_icon: null,
				personas: [
					{
						id: '200000000000000002',
						name: 'Wren',
						pronouns: 'she/her',
						bio: 'Keeps the **calendar**',
						visibility: 'public',
						avatar_hash: 'a1b2c3d4',
						banner_hash: 'e5f6a7b8',
					},
					{id: '200000000000000001', name: 'Ash', bio: 'Night-shift writer', visibility: 'public'},
				],
			},
		});
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	const render = async (user: User) => {
		await act(async () => {
			root.render(<PersonaGallery user={user} data-flx="persona.gallery-test.gallery" />);
		});
	};
	const typeSearch = async (value: string) => {
		const input = container.querySelector('input[type="text"]') as HTMLInputElement;
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
			setter.call(input, value);
			input.dispatchEvent(new Event('input', {bubbles: true}));
		});
	};

	it("shows someone else's public personas by name, asks the shared directory, and searches", async () => {
		await render(other);

		expect(mockDirectory.ensure).toHaveBeenCalledWith(other.id);
		expect(names(container, '[data-flx="persona.gallery.card.name-text"]')).toEqual(['Ash', 'Wren']);
		expect(container.textContent).toContain('Keeps the calendar');
		expect(container.textContent).not.toContain('Recently used');

		await typeSearch('writer');
		expect(names(container, '[data-flx="persona.gallery.card.name-text"]')).toEqual(['Ash']);
	});

	it('shows one’s own personas as others see them until unlisted and private are switched on, without a request', async () => {
		runInAction(() => {
			PersonaStore.setPersonas([
				{id: '300000000000000001', name: 'Shown', visibility: 'public', persona_tags: [{prefix: 's:', suffix: ''}]},
				{id: '300000000000000002', name: 'Hidden', visibility: 'unlisted'},
				{id: '300000000000000003', name: 'Secret', visibility: 'private'},
			] as any);
			PersonaGalleryPrefs.setView('list');
		});
		await render(owner);

		expect(mockDirectory.ensure).not.toHaveBeenCalled();
		expect(names(container, '[data-flx="persona.gallery.row.name"]')).toEqual(['Shown']);
		expect(container.textContent).toContain('s:text');

		const toggle = container.querySelector('[data-flx="persona.gallery.owner-bar"] [role="switch"]') as HTMLElement;
		await act(async () => toggle.click());
		expect(names(container, '[data-flx="persona.gallery.row.name"]')).toEqual(['Hidden', 'Secret', 'Shown']);
		expect(container.textContent).toContain('Unlisted');
		expect(container.textContent).toContain('Private');
	});

	it('opens a persona in place and steps through the list in its order', async () => {
		await render(other);
		const first = container.querySelector('[data-flx="persona.gallery.card.button"]') as HTMLElement;
		await act(async () => first.click());

		expect(container.querySelector('[data-flx="persona.gallery.detail.name"]')?.textContent).toBe('Ash');
		expect(container.textContent).toContain('1 of 2');

		await act(async () => (container.querySelector('[data-flx="persona.gallery.detail.next"]') as HTMLElement).click());
		expect(container.querySelector('[data-flx="persona.gallery.detail.name"]')?.textContent).toBe('Wren');

		await act(async () => (container.querySelector('[data-flx="persona.gallery.detail.back"]') as HTMLElement).click());
		expect(names(container, '[data-flx="persona.gallery.card.name-text"]')).toEqual(['Ash', 'Wren']);
	});

	it('opens the persona a popout asked for', async () => {
		PersonaGalleryNav.request(other.id, '200000000000000002');
		await render(other);

		expect(container.querySelector('[data-flx="persona.gallery.detail.name"]')?.textContent).toBe('Wren');
		expect(PersonaGalleryNav.pendingPersona(other.id)).toBeNull();
	});

	it('offers Try again after a failed request, and does not ask by itself', async () => {
		mockDirectory.get.mockReturnValue({status: 'failed', list: null});
		await render(other);
		const ensureCalls = mockDirectory.ensure.mock.calls.length;
		const retry = container.querySelector('[data-flx="persona.gallery.retry"]') as HTMLElement;

		expect(retry).not.toBeNull();
		await act(async () => retry.click());
		expect(mockDirectory.retry).toHaveBeenCalledWith(other.id);
		expect(mockDirectory.ensure.mock.calls.length).toBe(ensureCalls);
	});

	it('expands to the whole profile window and folds back with the button or Escape', async () => {
		const modalRoot = document.createElement('div');
		modalRoot.setAttribute('data-flx', 'user.user-profile-modal.modal-root');
		document.body.appendChild(modalRoot);
		const modalContainer = document.createElement('div');
		modalRoot.appendChild(modalContainer);
		const modalReactRoot = createRoot(modalContainer);
		await act(async () => {
			modalReactRoot.render(<PersonaGallery user={other} data-flx="persona.gallery-test.gallery" />);
		});
		const query = (flx: string) => modalContainer.querySelector(`[data-flx="${flx}"]`) as HTMLElement | null;

		expect(query('persona.gallery.expanded-bar')).toBeNull();
		const expand = query('persona.gallery.expand')!;
		expect(query('persona.gallery.toolbar')?.lastElementChild?.contains(expand)).toBe(true);
		expand.focus();
		await act(async () => expand.click());
		expect(modalRoot.getAttribute('data-persona-gallery-expanded')).toBe('true');
		expect(query('persona.gallery.expanded-bar')?.textContent).toContain('bob');
		expect(query('persona.gallery.expand')).toBeNull();
		// Restore takes Expand's place, last in the toolbar, and the slim bar has no button
		// (tyne-chat/tyne#589). It is the same button, so the keyboard's focus stays on it.
		const collapse = query('persona.gallery.collapse')!;
		expect(collapse).toBe(expand);
		expect(query('persona.gallery.toolbar')?.lastElementChild?.contains(collapse)).toBe(true);
		expect(query('persona.gallery.expanded-bar')?.querySelector('button')).toBeNull();
		expect(document.activeElement).toBe(collapse);

		await act(async () => collapse.click());
		expect(modalRoot.hasAttribute('data-persona-gallery-expanded')).toBe(false);

		await act(async () => query('persona.gallery.expand')!.click());
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
		});
		expect(modalRoot.hasAttribute('data-persona-gallery-expanded')).toBe(false);
		expect(query('persona.gallery.expanded-bar')).toBeNull();

		act(() => modalReactRoot.unmount());
		modalRoot.remove();
	});
	it('expands from an open persona too, and keeps it open', async () => {
		const modalRoot = document.createElement('div');
		modalRoot.setAttribute('data-flx', 'user.user-profile-modal.modal-root');
		document.body.appendChild(modalRoot);
		const modalContainer = document.createElement('div');
		modalRoot.appendChild(modalContainer);
		const modalReactRoot = createRoot(modalContainer);
		await act(async () => {
			modalReactRoot.render(<PersonaGallery user={other} data-flx="persona.gallery-test.gallery" />);
		});
		const query = (flx: string) => modalContainer.querySelector(`[data-flx="${flx}"]`) as HTMLElement | null;
		await act(async () => query('persona.gallery.card.button')!.click());
		// The button is last in the persona's nav row, after the arrows, in both states (tyne-chat/tyne#589).
		const lastInNav = () => query('persona.gallery.detail.nav')?.lastElementChild ?? null;

		expect(lastInNav()?.querySelector('[data-flx="persona.gallery.expand"]')).not.toBeNull();
		await act(async () => query('persona.gallery.expand')!.click());
		expect(modalRoot.getAttribute('data-persona-gallery-expanded')).toBe('true');
		expect(query('persona.gallery.expanded-bar')).not.toBeNull();
		expect(query('persona.gallery.expanded-bar')?.querySelector('button')).toBeNull();
		expect(query('persona.gallery.detail.name')?.textContent).toBe('Ash');
		expect(query('persona.gallery.expand')).toBeNull();
		expect(lastInNav()?.querySelector('[data-flx="persona.gallery.collapse"]')).not.toBeNull();

		await act(async () => query('persona.gallery.collapse')!.click());
		expect(modalRoot.hasAttribute('data-persona-gallery-expanded')).toBe(false);
		expect(query('persona.gallery.detail.name')?.textContent).toBe('Ash');
		expect(lastInNav()?.querySelector('[data-flx="persona.gallery.expand"]')).not.toBeNull();

		act(() => modalReactRoot.unmount());
		modalRoot.remove();
	});

	it('opens the avatar and banner menus on right-click in every view and in a persona, as profile cards do', async () => {
		const openFromEvent = vi.mocked(ContextMenuCommands.openFromEvent);
		// The variant of the menu each right-click opened ('avatar' or 'banner'), in order.
		const opened = () =>
			openFromEvent.mock.calls.map(([, renderMenu]) => (renderMenu({onClose: () => {}}) as any).props.variant);
		const rightClick = async (selector: string, index = 0) => {
			const target = container.querySelectorAll(selector)[index] as HTMLElement;
			await act(async () => {
				target.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
			});
		};
		const show = async (view: 'gallery' | 'list' | 'avatars') => {
			runInAction(() => PersonaGalleryPrefs.setView(view));
			await render(other);
		};

		// Gallery, in name order. Ash has no pictures of its own: its avatar is the account's default one
		// and it has no banner, so neither has a menu, as on an account's profile card.
		await show('gallery');
		await rightClick('[data-flx="persona.gallery.card.avatar"]', 0);
		await rightClick('[data-flx="persona.gallery.card.banner"]', 0);
		expect(opened()).toEqual([]);
		await rightClick('[data-flx="persona.gallery.card.avatar"]', 1);
		await rightClick('[data-flx="persona.gallery.card.banner"]', 1);
		expect(opened()).toEqual(['avatar', 'banner']);

		openFromEvent.mockClear();
		await show('list');
		await rightClick('[data-flx="persona.gallery.row.avatar-menu-target"]', 1);
		await rightClick('[data-flx="persona.gallery.row.strip"]', 1);
		expect(opened()).toEqual(['avatar', 'banner']);

		openFromEvent.mockClear();
		await show('avatars');
		await rightClick('[data-flx="persona.gallery.tile.image"]', 1);
		expect(opened()).toEqual(['avatar']);

		openFromEvent.mockClear();
		await act(async () =>
			(container.querySelectorAll('[data-flx="persona.gallery.tile.button"]')[1] as HTMLElement).click(),
		);
		expect(container.querySelector('[data-flx="persona.gallery.detail.name"]')?.textContent).toBe('Wren');
		await rightClick('[data-flx="persona.gallery.detail.avatar"]');
		await rightClick('[data-flx="persona.gallery.detail.banner"]');
		expect(opened()).toEqual(['avatar', 'banner']);
	});
});
