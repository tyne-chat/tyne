// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import React from 'react';
import {afterEach, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';

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

vi.mock('@app/features/messaging/hooks/useMessageReactionStore', () => ({
	useMessageReactions: vi.fn(() => []),
}));

vi.mock('@app/features/ui/commands/PopoutCommands', () => ({
	closeAll: vi.fn(),
	closeAllForDocument: vi.fn(),
}));

import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import * as ReactionCommands from '@app/features/messaging/commands/ReactionCommands';
import {useMessageReactions} from '@app/features/messaging/hooks/useMessageReactionStore';
import {PersonaReactAsModal} from '@app/features/persona/components/PersonaReactAsModal';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import type {MessageReaction} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ROW = '[data-flx="persona.reaction-list.row"]';

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

	const render = async (emoji: FlatEmoji = mockEmoji) => {
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={emoji}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal"
				/>,
			);
		});
	};
	const rows = () => Array.from(document.querySelectorAll<HTMLButtonElement>(ROW));
	const rowNames = () =>
		rows().map((row) => row.querySelector('[data-flx="persona.reaction-list.row-name"]')?.textContent);
	const typeSearch = async (value: string) => {
		const input = document.querySelector('input')!;
		await act(async () => {
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
			input.dispatchEvent(new Event('input', {bubbles: true}));
		});
	};
	const keyOnSearch = async (key: string) => {
		const input = document.querySelector('input')!;
		await act(async () => {
			input.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
		});
	};

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		vi.clearAllMocks();
		vi.mocked(useMessageReactions).mockReturnValue([]);

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
				{id: 'p1', name: 'Alice', pronouns: 'she/her'} as any,
				{id: 'p2', name: 'Bob', pronouns: 'he/him'} as any,
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

	it('lists the account, marked current, then the personas by name', async () => {
		await render();

		expect(document.body.textContent).toContain('React as...');
		expect(rowNames()).toEqual(['testuser', 'Alice', 'Bob']);
		expect(rows()[0]!.textContent).toContain('Current');
		expect(rows()[0]!.textContent).toContain('Account');
		expect(rows().every((row) => row.getAttribute('aria-pressed') === 'false')).toBe(true);
	});

	it('lists those who already reacted first, and a click on one removes its reaction', async () => {
		const reaction: MessageReaction = {
			emoji: {id: null, name: '⭐'},
			count: 1,
			me: true,
			me_root: false,
			persona_reactions: [{persona_id: 'p2', count: 1, me: true}],
		} as MessageReaction;
		vi.mocked(useMessageReactions).mockReturnValue([reaction]);
		await render();

		expect(rowNames()).toEqual(['Bob', 'testuser', 'Alice']);
		expect(document.body.textContent).toContain('Reacted');
		expect(document.body.textContent).toContain('Everyone else');
		expect(document.body.textContent).toContain('1 of 3 reacted');
		expect(rows()[0]!.getAttribute('aria-pressed')).toBe('true');

		await act(async () => {
			rows()[0]!.click();
		});

		expect(ReactionCommands.removeReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			undefined,
			'p2',
		);
		expect(ReactionCommands.addReaction).not.toHaveBeenCalled();
	});

	it('reacts as the persona clicked and stays open', async () => {
		await render();

		await act(async () => {
			rows()[1]!.click();
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			'p1',
		);
		expect(mockOnClose).not.toHaveBeenCalled();
		expect(PopoutCommands.closeAll).not.toHaveBeenCalled();
	});

	it('reacts as the account when its row is clicked', async () => {
		await render();

		await act(async () => {
			rows()[0]!.click();
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			null,
		);
	});

	it('lets several personas react in a row, one request each', async () => {
		await render();

		await act(async () => {
			rows()[1]!.click();
			rows()[2]!.click();
		});

		expect(ReactionCommands.addReaction).toHaveBeenCalledTimes(2);
		expect(vi.mocked(ReactionCommands.addReaction).mock.calls.map((call) => call[4])).toEqual(['p1', 'p2']);
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('moves through the rows with the arrow keys; Enter toggles the highlighted row and stays open', async () => {
		await render();

		await keyOnSearch('ArrowDown');
		await keyOnSearch('ArrowDown');
		await keyOnSearch('ArrowUp');
		await keyOnSearch('Enter');

		expect(ReactionCommands.addReaction).toHaveBeenLastCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			'p1',
		);
		expect(mockOnClose).not.toHaveBeenCalled();

		await keyOnSearch('ArrowUp');
		await keyOnSearch('Enter');

		expect(ReactionCommands.addReaction).toHaveBeenLastCalledWith(
			expect.anything(),
			'c1',
			'm1',
			expect.objectContaining({name: '⭐'}),
			null,
		);
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('filters by name, and says so when nobody matches', async () => {
		await render();

		await typeSearch('Alice');
		expect(rowNames()).toEqual(['Alice']);
		expect(document.body.textContent).toContain('Results');

		await typeSearch('nobody-by-this-name');
		expect(rows()).toHaveLength(0);
		expect(document.body.textContent).toContain('No one matches.');
	});

	// The display tag is the account's, shared by every persona listed here, so it must not make every
	// persona match (tyne#160, M4-13).
	it('does not match every persona when the query is part of the display tag', async () => {
		runInAction(() => PersonaStore.updateSettings({display_tag_text: "Alice's System"}));
		onTestFinished(() => runInAction(() => PersonaStore.updateSettings({display_tag_text: ''})));
		await render();

		await typeSearch('Alice');

		expect(rowNames()).toEqual(['Alice']);
	});

	it('closes on Done without reacting', async () => {
		await render();

		const done = document.querySelector<HTMLButtonElement>('[data-flx="persona.persona-react-as-modal.done"]')!;
		await act(async () => {
			done.click();
		});

		expect(mockOnClose).toHaveBeenCalled();
		expect(ReactionCommands.addReaction).not.toHaveBeenCalled();
		expect(ReactionCommands.removeReaction).not.toHaveBeenCalled();
	});

	// The phone layout opens this dialog from a reaction chip, which hands over the reaction's own emoji.
	it("takes a reaction chip's emoji as it is", async () => {
		const reaction: MessageReaction = {
			emoji: {id: null, name: '😆'},
			count: 1,
			me: true,
			me_root: false,
			persona_reactions: [{persona_id: 'p1', count: 1, me: true}],
		} as MessageReaction;
		vi.mocked(useMessageReactions).mockReturnValue([reaction]);
		await act(async () => {
			root.render(
				<PersonaReactAsModal
					emoji={{id: null, name: '😆'}}
					channelId="c1"
					messageId="m1"
					onClose={mockOnClose}
					data-flx="persona.persona-react-as-modal-test.persona-react-as-modal--2"
				/>,
			);
		});

		expect(rowNames()[0]).toBe('Alice');
		expect(rows()[0]!.getAttribute('aria-pressed')).toBe('true');
		await act(async () => {
			rows()[0]!.click();
		});
		expect(ReactionCommands.removeReaction).toHaveBeenCalledWith(
			expect.anything(),
			'c1',
			'm1',
			{id: null, name: '😆'},
			undefined,
			'p1',
		);
	});

	// tyne-chat/tyne#86: with "React as several personas at once" off, a pick is a single choice.
	it('with one reaction per emoji, replaces the account’s reaction with the pick and closes', async () => {
		runInAction(() => PersonaStore.updateSettings({multi_persona_reactions: false}));
		onTestFinished(() => runInAction(() => PersonaStore.updateSettings({multi_persona_reactions: true})));
		const reaction: MessageReaction = {
			emoji: {id: null, name: '⭐'},
			count: 1,
			me: true,
			me_root: false,
			persona_reactions: [{persona_id: 'p1', count: 1, me: true}],
		} as MessageReaction;
		vi.mocked(useMessageReactions).mockReturnValue([reaction]);
		await render();

		// Alice (p1) reacted; pick Bob.
		await act(async () => {
			rows()
				.find((row) => row.textContent?.includes('Bob'))!
				.click();
		});

		expect(vi.mocked(ReactionCommands.removeReaction).mock.calls.map((call) => call[5])).toEqual(['p1']);
		expect(vi.mocked(ReactionCommands.addReaction).mock.calls.map((call) => call[4])).toEqual(['p2']);
		expect(mockOnClose).toHaveBeenCalledTimes(1);
		expect(PopoutCommands.closeAll).toHaveBeenCalled();
	});

	it('reacts with a custom emoji by its id', async () => {
		await render({
			id: '998877665544332211',
			name: 'blob_dance',
			uniqueName: 'blob_dance:998877665544332211',
			allNamesString: ':blob_dance:',
			animated: true,
		});

		await act(async () => {
			rows()[1]!.click();
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
