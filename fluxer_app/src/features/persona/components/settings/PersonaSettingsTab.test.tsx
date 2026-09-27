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
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

vi.mock('@app/features/persona/components/modals/PersonaEditModal', () => ({
	openPersonaEditModal: vi.fn(),
	PersonaEditModal: () => (
		<div data-testid="edit-modal" data-flx="persona.settings.persona-settings-tab-test.persona-edit-modal.edit-modal" />
	),
}));

vi.mock('@app/features/persona/components/modals/PluralKitImportModal', () => ({
	openPluralKitImportModal: vi.fn(),
	PluralKitImportModal: () => (
		<div
			data-testid="import-modal"
			data-flx="persona.settings.persona-settings-tab-test.plural-kit-import-modal.import-modal"
		/>
	),
}));

vi.mock('@app/features/ui/commands/UnsavedChangesCommands', () => ({
	setUnsavedChanges: vi.fn(),
	setTabData: vi.fn(),
	clearUnsavedChanges: vi.fn(),
}));

import {openPersonaEditModal} from '@app/features/persona/components/modals/PersonaEditModal';
import {openPluralKitImportModal} from '@app/features/persona/components/modals/PluralKitImportModal';
import {PersonaSettingsTab} from '@app/features/persona/components/settings/PersonaSettingsTab';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';

describe('PersonaSettingsTab Component', () => {
	let container: HTMLDivElement;
	let root: Root;

	const personaA = {
		id: '100000000000000011',
		name: 'Persona Alpha',
		avatar_hash: null,
		pronouns: 'she/her',
		persona_tags: [{prefix: '[A]', suffix: ''}],
	} as any;

	const personaB = {
		id: '100000000000000012',
		name: 'Persona Beta',
		avatar_hash: null,
		pronouns: 'they/them',
		persona_tags: [{prefix: '[B]', suffix: ''}],
	} as any;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
		runInAction(() => {
			PersonaStore.reset();
			PersonaStore.setPersonas([personaA, personaB]);
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it('renders configured personas list and count', async () => {
		await act(async () => {
			root.render(<PersonaSettingsTab data-flx="persona.settings.persona-settings-tab-test.persona-settings-tab" />);
		});

		expect(container.textContent).toContain('Configured Personas (2)');
		expect(container.textContent).toContain('Persona Alpha');
		expect(container.textContent).toContain('Persona Beta');
	});

	it('opens PersonaEditModal when Add Persona button is clicked', async () => {
		await act(async () => {
			root.render(<PersonaSettingsTab data-flx="persona.settings.persona-settings-tab-test.persona-settings-tab--2" />);
		});

		const addBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
			btn.textContent?.includes('Add Persona'),
		);
		expect(addBtn).toBeDefined();

		await act(async () => {
			addBtn?.click();
		});

		expect(openPersonaEditModal).toHaveBeenCalledWith();
	});

	it('opens PluralKitImportModal when Import from PluralKit button is clicked', async () => {
		await act(async () => {
			root.render(<PersonaSettingsTab data-flx="persona.settings.persona-settings-tab-test.persona-settings-tab--3" />);
		});

		const importBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
			btn.textContent?.includes('Import from PluralKit'),
		);
		expect(importBtn).toBeDefined();

		await act(async () => {
			importBtn?.click();
		});

		expect(openPluralKitImportModal).toHaveBeenCalledTimes(1);
	});

	it('opens PersonaEditModal with persona when persona edit button is clicked', async () => {
		await act(async () => {
			root.render(<PersonaSettingsTab data-flx="persona.settings.persona-settings-tab-test.persona-settings-tab--4" />);
		});

		const editButtons = container.querySelectorAll('[aria-label="Edit persona"]');
		expect(editButtons.length).toBe(2);

		await act(async () => {
			(editButtons[0] as HTMLElement).click();
		});

		expect(openPersonaEditModal).toHaveBeenCalledWith(
			expect.objectContaining({id: personaA.id, name: 'Persona Alpha'}),
		);
	});

	it('toggles active persona when Set Active button is clicked', async () => {
		PersonaStore.setActivePersona = vi.fn().mockResolvedValue(undefined) as any;

		await act(async () => {
			root.render(<PersonaSettingsTab data-flx="persona.settings.persona-settings-tab-test.persona-settings-tab--5" />);
		});

		const setActiveBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
			btn.textContent?.includes('Set Active'),
		);
		expect(setActiveBtn).toBeDefined();

		await act(async () => {
			setActiveBtn?.click();
		});

		expect(PersonaStore.setActivePersona).toHaveBeenCalledWith(personaA.id, true);
	});

	it('filters personas by search query', async () => {
		await act(async () => {
			root.render(<PersonaSettingsTab data-flx="persona.settings.persona-settings-tab-test.persona-settings-tab--6" />);
		});

		const searchInput = container.querySelector(
			'[data-flx="user.persona-settings-tab.search-input"]',
		) as HTMLInputElement;
		expect(searchInput).not.toBeNull();

		await act(async () => {
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
			nativeInputValueSetter?.call(searchInput, 'Beta');
			searchInput.dispatchEvent(new Event('input', {bubbles: true}));
		});

		expect(container.textContent).toContain('Persona Beta');
		expect(container.textContent).not.toContain('Persona Alpha');
	});

	it('opens PersonaEditModal on initialSubtab="new"', async () => {
		await act(async () => {
			root.render(
				<PersonaSettingsTab
					initialSubtab="new"
					data-flx="persona.settings.persona-settings-tab-test.persona-settings-tab--7"
				/>,
			);
		});

		expect(openPersonaEditModal).toHaveBeenCalledWith();
	});
});
