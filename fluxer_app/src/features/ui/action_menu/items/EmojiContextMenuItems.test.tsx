// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {runInAction} from 'mobx';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
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
				<div ref={ref} data-flx="ui.action-menu.items.emoji-context-menu-items-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="ui.action-menu.items.emoji-context-menu-items-test.span" {...props} />
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

vi.mock('@app/features/ui/action_menu/MenuItem', () => ({
	MenuItem: ({children, onClick, icon, ...props}: any) => (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			data-flx="ui.action-menu.items.emoji-context-menu-items-test.menu-item.menuitem.click.button"
			{...props}
		>
			{icon}
			{children}
		</button>
	),
}));

vi.mock('@app/features/ui/action_menu/MenuGroup', () => ({
	MenuGroup: ({children, ...props}: any) => (
		<div role="group" data-flx="ui.action-menu.items.emoji-context-menu-items-test.menu-group.group" {...props}>
			{children}
		</div>
	),
}));

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: vi.fn(),
	pop: vi.fn(),
	modal: (renderer: () => React.ReactNode) => renderer,
}));

vi.mock('@app/features/emoji/commands/EmojiPickerCommands', () => ({
	toggleFavorite: vi.fn(),
}));

vi.mock('@app/features/ui/commands/TextCopyCommands', () => ({
	copy: vi.fn(),
}));

vi.mock('@app/features/ui/commands/ToastCommands', () => ({
	createToast: vi.fn(),
}));

import * as EmojiPickerCommands from '@app/features/emoji/commands/EmojiPickerCommands';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as TextCopyCommands from '@app/features/ui/commands/TextCopyCommands';
import {EmojiContextMenuItems} from './EmojiContextMenuItems';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('EmojiContextMenuItems', () => {
	let container: HTMLDivElement;
	let root: Root;
	const mockOnClose = vi.fn();

	const unicodeEmoji: FlatEmoji = {
		name: 'thumbsup',
		surrogates: '👍',
		uniqueName: 'thumbsup',
		allNamesString: ':thumbsup:',
		animated: false,
	};

	const customEmoji: FlatEmoji = {
		id: '123456789012345678',
		name: 'super_fox',
		uniqueName: 'super_fox:123456789012345678',
		allNamesString: ':super_fox:',
		animated: false,
		guildId: 'guild-1',
	};

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		mockOnClose.mockClear();
		vi.clearAllMocks();

		runInAction(() => {
			PersonaStore.setPersonas([
				{
					id: 'p1',
					name: 'Kitsune',
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

	it('renders "React as..." item when user has personas and message/channel IDs are provided', async () => {
		await act(async () => {
			root.render(
				<EmojiContextMenuItems
					emoji={unicodeEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="ui.action-menu.items.emoji-context-menu-items-test.emoji-context-menu-items"
				/>,
			);
		});

		expect(document.body.textContent).toContain('React as...');
		const reactAsGroup = document.querySelector(
			'[data-flx="ui.action-menu.items.emoji-context-menu-items.react-as-menu-group"]',
		);
		expect(reactAsGroup).not.toBeNull();
	});

	it('opens PersonaReactAsModal and closes menu when "React as..." is clicked', async () => {
		await act(async () => {
			root.render(
				<EmojiContextMenuItems
					emoji={unicodeEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="ui.action-menu.items.emoji-context-menu-items-test.emoji-context-menu-items--2"
				/>,
			);
		});

		const reactAsItem = document.querySelector(
			'[data-flx="ui.action-menu.items.emoji-context-menu-items.react-as-menu-group"] [role="menuitem"]',
		) as HTMLElement;
		expect(reactAsItem).not.toBeNull();

		await act(async () => {
			reactAsItem.click();
		});

		expect(mockOnClose).toHaveBeenCalledTimes(1);
		expect(ModalCommands.push).toHaveBeenCalledTimes(1);
	});

	it('hides "React as..." when user has no personas', async () => {
		runInAction(() => {
			PersonaStore.setPersonas([]);
		});

		await act(async () => {
			root.render(
				<EmojiContextMenuItems
					emoji={unicodeEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="ui.action-menu.items.emoji-context-menu-items-test.emoji-context-menu-items--3"
				/>,
			);
		});

		expect(document.body.textContent).not.toContain('React as...');
		const reactAsGroup = document.querySelector(
			'[data-flx="ui.action-menu.items.emoji-context-menu-items.react-as-menu-group"]',
		);
		expect(reactAsGroup).toBeNull();
	});

	it('hides "React as..." when channelId or messageId is missing', async () => {
		await act(async () => {
			root.render(
				<EmojiContextMenuItems
					emoji={unicodeEmoji}
					onClose={mockOnClose}
					data-flx="ui.action-menu.items.emoji-context-menu-items-test.emoji-context-menu-items--4"
				/>,
			);
		});

		expect(document.body.textContent).not.toContain('React as...');
	});

	it('supports toggling favorite emoji', async () => {
		await act(async () => {
			root.render(
				<EmojiContextMenuItems
					emoji={unicodeEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="ui.action-menu.items.emoji-context-menu-items-test.emoji-context-menu-items--5"
				/>,
			);
		});

		const favItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
			(el) => el.textContent?.includes('Favorite emoji') || el.textContent?.includes('Unfavorite emoji'),
		) as HTMLElement;

		if (favItem) {
			await act(async () => {
				favItem.click();
			});
			expect(EmojiPickerCommands.toggleFavorite).toHaveBeenCalledWith(unicodeEmoji);
		}
	});

	it('supports copying custom emoji ID', async () => {
		await act(async () => {
			root.render(
				<EmojiContextMenuItems
					emoji={customEmoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="ui.action-menu.items.emoji-context-menu-items-test.emoji-context-menu-items--6"
				/>,
			);
		});

		const copyIdItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
			el.textContent?.includes('Copy emoji ID'),
		) as HTMLElement;

		expect(copyIdItem).toBeTruthy();
		await act(async () => {
			copyIdItem.click();
		});

		expect(TextCopyCommands.copy).toHaveBeenCalledWith(expect.anything(), '123456789012345678');
		expect(mockOnClose).toHaveBeenCalled();
	});
});
