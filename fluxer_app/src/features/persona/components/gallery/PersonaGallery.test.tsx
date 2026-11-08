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
vi.mock('@app/features/messaging/components/markdown', () => ({
	SafeMarkdown: ({content}: {content?: string}) => <div data-flx="persona.gallery-test.safe-markdown">{content}</div>,
}));

import {PersonaGallery} from '@app/features/persona/components/gallery/PersonaGallery';
import {PersonaGalleryNav} from '@app/features/persona/state/PersonaGalleryNav';
import {PersonaGalleryPrefs} from '@app/features/persona/state/PersonaGalleryPrefs';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
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
});
