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
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) => {
				let msg = descriptor.message ?? '';
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

vi.mock('@app/features/user/state/Users', () => ({
	default: {
		getCurrentUser: vi.fn(),
	},
}));

vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	fetchPersonas: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: vi.fn(),
	modal: vi.fn((fn) => fn),
}));

import {PersonaPickerSheet} from '@app/features/persona/components/PersonaPickerSheet';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PersonaPickerSheet Component', () => {
	let container: HTMLDivElement;
	let root: Root;
	const mockUser = new User({
		id: '100000000000000001',
		username: 'alice',
		discriminator: '0001',
		avatar: null,
		flags: 0,
	} as any);

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
		vi.mocked(Users.getCurrentUser).mockReturnValue(mockUser);
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

	it('renders root account and personas list', async () => {
		const onClose = vi.fn();
		const onSelectPersona = vi.fn();
		const onSelectAccount = vi.fn();

		await act(async () => {
			root.render(
				<PersonaPickerSheet
					onClose={onClose}
					onSelectPersona={onSelectPersona}
					onSelectAccount={onSelectAccount}
					data-flx="persona.persona-picker-sheet-test.persona-picker-sheet"
				/>,
			);
		});

		expect(container.textContent).toContain('alice');
		expect(container.textContent).toContain('Persona Alpha');
		expect(container.textContent).toContain('Persona Beta');
	});

	it('selects root account when root account row is clicked', async () => {
		const onClose = vi.fn();
		const onSelectPersona = vi.fn();
		const onSelectAccount = vi.fn();

		await act(async () => {
			root.render(
				<PersonaPickerSheet
					onClose={onClose}
					onSelectPersona={onSelectPersona}
					onSelectAccount={onSelectAccount}
					data-flx="persona.persona-picker-sheet-test.persona-picker-sheet--2"
				/>,
			);
		});

		const rootItem = Array.from(container.querySelectorAll('[role="button"]')).find((el) =>
			el.textContent?.includes('Root Account'),
		) as HTMLElement | undefined;

		expect(rootItem).toBeDefined();

		await act(async () => {
			rootItem?.click();
		});

		expect(onSelectAccount).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('selects persona when persona row is clicked', async () => {
		const onClose = vi.fn();
		const onSelectPersona = vi.fn();
		const onSelectAccount = vi.fn();

		await act(async () => {
			root.render(
				<PersonaPickerSheet
					onClose={onClose}
					onSelectPersona={onSelectPersona}
					onSelectAccount={onSelectAccount}
					data-flx="persona.persona-picker-sheet-test.persona-picker-sheet--3"
				/>,
			);
		});

		const alphaItem = Array.from(container.querySelectorAll('[role="button"]')).find((el) =>
			el.textContent?.includes('Persona Alpha'),
		) as HTMLElement | undefined;

		expect(alphaItem).toBeDefined();

		await act(async () => {
			alphaItem?.click();
		});

		expect(onSelectPersona).toHaveBeenCalledWith(personaA.id);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('filters personas by search query', async () => {
		const onClose = vi.fn();
		const onSelectPersona = vi.fn();
		const onSelectAccount = vi.fn();

		await act(async () => {
			root.render(
				<PersonaPickerSheet
					onClose={onClose}
					onSelectPersona={onSelectPersona}
					onSelectAccount={onSelectAccount}
					data-flx="persona.persona-picker-sheet-test.persona-picker-sheet--4"
				/>,
			);
		});

		const searchInput = container.querySelector('input[type="text"]') as HTMLInputElement;
		expect(searchInput).not.toBeNull();

		await act(async () => {
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
			nativeInputValueSetter?.call(searchInput, 'Beta');
			searchInput.dispatchEvent(new Event('input', {bubbles: true}));
		});

		expect(container.textContent).toContain('Persona Beta');
		expect(container.textContent).not.toContain('Persona Alpha');
	});

	it('opens settings when manage personas button is clicked', async () => {
		const onClose = vi.fn();
		const onSelectPersona = vi.fn();
		const onSelectAccount = vi.fn();

		await act(async () => {
			root.render(
				<PersonaPickerSheet
					onClose={onClose}
					onSelectPersona={onSelectPersona}
					onSelectAccount={onSelectAccount}
					data-flx="persona.persona-picker-sheet-test.persona-picker-sheet--5"
				/>,
			);
		});

		const manageBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
			btn.textContent?.includes('Manage Personas'),
		);

		expect(manageBtn).toBeDefined();

		await act(async () => {
			manageBtn?.click();
		});

		expect(ModalCommands.push).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
