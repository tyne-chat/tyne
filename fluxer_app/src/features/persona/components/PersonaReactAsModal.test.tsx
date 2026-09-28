// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('framer-motion', async () => {
	const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
	return {
		...actual,
		motion: {
			div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
				<div ref={ref} data-flx="persona.persona-react-as-modal-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="persona.persona-react-as-modal-test.span" {...props} />
			)),
		},
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

vi.mock('@app/features/messaging/commands/ReactionCommands', () => ({
	addReaction: vi.fn(),
	removeReaction: vi.fn(),
}));

vi.mock('@app/features/ui/commands/PopoutCommands', () => ({
	closeAll: vi.fn(),
	closeAllForDocument: vi.fn(),
}));

import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import * as ReactionCommands from '@app/features/messaging/commands/ReactionCommands';
import {PersonaReactAsModal} from '@app/features/persona/components/PersonaReactAsModal';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PersonaReactAsModal', () => {
	let container: HTMLDivElement;
	let root: Root;
	const mockOnClose = vi.fn();
	const mockEmoji: FlatEmoji = {
		name: 'star',
		surrogates: '⭐',
		uniqueName: 'star',
		allNamesString: ':star:',
		animated: false,
	};

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		mockOnClose.mockClear();
		vi.clearAllMocks();

		const testUser = new User({
			id: '1000',
			username: 'testuser',
			discriminator: '0',
			avatar: null,
			flags: 0,
		} as any);
		vi.mocked(Users.getCurrentUser).mockReturnValue(testUser);

		runInAction(() => {
			PersonaStore.setPersonas([
				{
					id: 'p1',
					name: 'Alice',
					pronouns: 'she/her',
				} as any,
				{
					id: 'p2',
					name: 'Bob',
					pronouns: 'he/him',
				} as any,
			]);
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.replaceChildren();
		vi.clearAllMocks();
	});

	it('renders root account and list of personas', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal"
				/>,
			);
		});

		expect(document.body.textContent).toContain('React as...');
		expect(document.body.textContent).toContain('testuser');
		expect(document.body.textContent).toContain('Root Account (Default)');
		expect(document.body.textContent).toContain('Alice');
		expect(document.body.textContent).toContain('Bob');
	});

	it('filters personas when typing in search input', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--2"
				/>,
			);
		});

		const input = document.querySelector('input')!;
		expect(input).not.toBeNull();

		await act(async () => {
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
			nativeInputValueSetter?.call(input, 'Alice');
			input.dispatchEvent(new Event('input', {bubbles: true}));
		});

		expect(document.body.textContent).toContain('Alice');
		expect(document.body.textContent).not.toContain('Bob');
		expect(document.body.textContent).not.toContain('Root Account (Default)');
	});

	it('reacts as persona when a persona is clicked', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--3"
				/>,
			);
		});

		const items = document.querySelectorAll('[data-flx="persona.persona-react-as-modal.persona-item"]');
		expect(items.length).toBe(2);

		await act(async () => {
			(items[0] as HTMLElement).click();
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			'p1',
		);
		expect(mockOnClose).toHaveBeenCalled();
		expect(PopoutCommands.closeAll).toHaveBeenCalled();
	});

	it('reacts as root account when root account is clicked', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--4"
				/>,
			);
		});

		const rootItem = document.querySelector(
			'[data-flx="persona.persona-react-as-modal.root-account-item"]',
		) as HTMLElement;
		expect(rootItem).toBeTruthy();

		await act(async () => {
			rootItem.click();
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			null,
		);
		expect(mockOnClose).toHaveBeenCalled();
		expect(PopoutCommands.closeAll).toHaveBeenCalled();
	});

	it('supports keyboard navigation with ArrowDown, ArrowUp, and Enter', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--5"
				/>,
			);
		});

		const input = document.querySelector('input')!;
		expect(input).not.toBeNull();

		// Press ArrowDown to navigate from root (0) to Alice (1)
		await act(async () => {
			input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
		});

		// Press ArrowUp to navigate back from Alice (1) to root (0)
		await act(async () => {
			input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
		});

		// Press ArrowDown to navigate back to Alice (1)
		await act(async () => {
			input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
		});

		// Press Enter to select Alice (1)
		await act(async () => {
			input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			'p1',
		);
		expect(mockOnClose).toHaveBeenCalled();
	});

	it('supports keyboard navigation to select root account via Enter', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--6"
				/>,
			);
		});

		const input = document.querySelector('input')!;

		// selectedIndex starts at 0 (root account). Press Enter immediately.
		await act(async () => {
			input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			null,
		);
		expect(mockOnClose).toHaveBeenCalled();
	});

	it('shows empty notice when no personas match search query', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--7"
				/>,
			);
		});

		const input = document.querySelector('input')!;
		await act(async () => {
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
			nativeInputValueSetter?.call(input, 'NonexistentPersonaXYZ');
			input.dispatchEvent(new Event('input', {bubbles: true}));
		});

		expect(document.body.textContent).toContain('No matching personas found.');
	});

	it('updates selectedIndex on mouseEnter for root and persona items', async () => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={mockEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--8"
				/>,
			);
		});

		const rootItem = document.querySelector(
			'[data-flx="persona.persona-react-as-modal.root-account-item"]',
		) as HTMLElement;
		const personaItems = document.querySelectorAll('[data-flx="persona.persona-react-as-modal.persona-item"]');

		await act(async () => {
			personaItems[1].dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
		});

		await act(async () => {
			rootItem.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
		});
	});

	it('supports custom emojis with id and animated properties', async () => {
		const customEmoji: FlatEmoji = {
			id: '998877665544332211',
			name: 'blob_dance',
			uniqueName: 'blob_dance:998877665544332211',
			allNamesString: ':blob_dance:',
			animated: true,
		};

		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={customEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--9"
				/>,
			);
		});

		const personaItems = document.querySelectorAll('[data-flx="persona.persona-react-as-modal.persona-item"]');
		await act(async () => {
			(personaItems[0] as HTMLElement).click();
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({id: '998877665544332211'}),
			'p1',
		);
	});
});
