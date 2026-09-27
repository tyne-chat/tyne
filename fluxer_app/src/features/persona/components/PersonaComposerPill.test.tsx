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

import {PersonaComposerPill} from '@app/features/persona/components/PersonaComposerPill';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PersonaComposerPill Component', () => {
	let container: HTMLDivElement;
	let root: Root;
	const mockUser = new User({
		id: '100000000000000001',
		username: 'alice',
		discriminator: '0001',
		avatar: null,
		flags: 0,
	} as any);

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
		vi.mocked(Users.getCurrentUser).mockReturnValue(mockUser);
		runInAction(() => {
			PersonaStore.reset();
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it('returns null when user has no personas', async () => {
		runInAction(() => {
			PersonaStore.reset();
		});

		await act(async () => {
			root.render(<PersonaComposerPill data-flx="persona.persona-composer-pill-test.persona-composer-pill" />);
		});

		expect(container.innerHTML).toBe('');
	});

	it('renders root username when persona mode is active but unlatched', async () => {
		runInAction(() => {
			PersonaStore.setPersonas([{id: 'p1', name: 'Persona 1', avatar_hash: null} as any]);
			(PersonaStore as any)._activePersonaMode = 'last';
			(PersonaStore as any)._activePersonaId = null;
			(PersonaStore as any)._isPersonaLatched = false;
		});

		await act(async () => {
			root.render(<PersonaComposerPill data-flx="persona.persona-composer-pill-test.persona-composer-pill--2" />);
		});

		const button = container.querySelector('button');
		expect(button).not.toBeNull();
		expect(button?.getAttribute('aria-label')).toContain('alice');
	});

	it('renders latched active persona name', async () => {
		const activeP = {
			id: 'p_latched',
			name: 'Latched Persona',
			avatar_hash: null,
		} as any;

		runInAction(() => {
			PersonaStore.setPersonas([activeP]);
			(PersonaStore as any)._activePersonaId = 'p_latched';
			(PersonaStore as any)._isPersonaLatched = true;
		});

		await act(async () => {
			root.render(<PersonaComposerPill data-flx="persona.persona-composer-pill-test.persona-composer-pill--3" />);
		});

		const button = container.querySelector('button');
		expect(button).not.toBeNull();
		expect(button?.getAttribute('aria-label')).toContain('Latched Persona');
	});

	it('renders tag-matched persona name when draft text matches proxy tags', async () => {
		const tagMatchedP = {
			id: 'p_tag',
			name: 'Tag Persona',
			avatar_hash: null,
			persona_tags: [{prefix: '[', suffix: ']'}],
		} as any;

		runInAction(() => {
			PersonaStore.setPersonas([tagMatchedP]);
			(PersonaStore as any)._activePersonaId = null;
			(PersonaStore as any)._isPersonaLatched = false;
		});

		await act(async () => {
			root.render(
				<PersonaComposerPill
					text="[hello from tag]"
					data-flx="persona.persona-composer-pill-test.persona-composer-pill--4"
				/>,
			);
		});

		const button = container.querySelector('button');
		expect(button).not.toBeNull();
		expect(button?.getAttribute('aria-label')).toContain('Tag Persona');
	});
});
