// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

installVoiceMenuTestBootstrap();

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('framer-motion', async () => {
	const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
	return {
		...actual,
		motion: {
			div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
				<div ref={ref} data-flx="persona.persona-profile-modal-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="persona.persona-profile-modal-test.span" {...props} />
			)),
		},
	};
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: React.ReactNode}) => <>{children}</>,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) => {
				let msg = descriptor?.message ?? '';
				if (values) {
					for (const [k, v] of Object.entries(values)) {
						msg = msg.replace(`{${k}}`, String(v));
					}
				}
				return msg;
			},
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/persona/components/PersonaProfilePopout', () => ({
	PersonaProfilePopout: () => (
		<div
			data-testid="persona-popout-mock"
			data-flx="persona.persona-profile-modal-test.persona-profile-popout.persona-popout-mock"
		/>
	),
}));

const {PersonaProfileModal} = await import('./PersonaProfileModal');

describe('PersonaProfileModal', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.replaceChildren();
		vi.clearAllMocks();
	});

	const mockUser = {
		id: 'user_12345',
		username: 'testuser',
		tag: 'testuser#0001',
	} as unknown as User;

	const mockSubprofile: MessageSubprofileResponse = {
		id: 'sub_123',
		name: 'Caelum',
		avatar: null,
		system_name: 'Starlight',
		pronouns: 'they/them',
	};

	it('renders with accessible Modal.ScreenReaderLabel and does not throw', async () => {
		const onClose = vi.fn();

		expect(() => {
			act(() => {
				root.render(
					<PersonaProfileModal
						subprofile={mockSubprofile}
						user={mockUser}
						onClose={onClose}
						data-flx="persona.persona-profile-modal-test.persona-profile-modal"
					/>,
				);
			});
		}).not.toThrow();

		await act(async () => {
			await Promise.resolve();
		});

		const screenReaderLabel = document.querySelector('[data-flx="app.modal.screen-reader-label.screen-reader-label"]');
		expect(screenReaderLabel).not.toBeNull();
		expect(screenReaderLabel?.textContent).toBe('Persona profile: Caelum');

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();
		expect(dialog?.getAttribute('aria-labelledby')).toBe(screenReaderLabel?.id);
	});

	it('falls back to generic persona profile label when name is empty', async () => {
		const onClose = vi.fn();
		const emptyNameSubprofile: MessageSubprofileResponse = {
			...mockSubprofile,
			name: '',
		};

		act(() => {
			root.render(
				<PersonaProfileModal
					subprofile={emptyNameSubprofile}
					user={mockUser}
					onClose={onClose}
					data-flx="persona.persona-profile-modal-test.persona-profile-modal--2"
				/>,
			);
		});

		await act(async () => {
			await Promise.resolve();
		});

		const screenReaderLabel = document.querySelector('[data-flx="app.modal.screen-reader-label.screen-reader-label"]');
		expect(screenReaderLabel).not.toBeNull();
		expect(screenReaderLabel?.textContent).toBe('Persona profile');
	});
});
