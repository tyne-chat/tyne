// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

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
		AnimatePresence: ({children}: {children?: React.ReactNode}) => children,
		motion: {
			div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
				<div ref={ref} data-flx="channel.message-reactions-context-menu-test.div" {...props} />
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
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) =>
				Object.entries(values ?? {}).reduce(
					(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
					descriptor.message ?? '',
				),
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/ui/commands/ContextMenuCommands', () => ({
	openFromEvent: vi.fn(),
}));

import Messages from '@app/features/messaging/state/MessagingMessages';
import {EmojiInlineMenuItems} from '@app/features/ui/action_menu/items/EmojiContextMenuItems';
import {MessageContextMenu} from '@app/features/ui/action_menu/MessageContextMenu';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {MessageReactions} from './MessageReactions';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CHANNEL_ID = 'c-reactions';
const MESSAGE_ID = '1555923739894349825';
const customReaction = {emoji: {id: '123456789012345678', name: 'Cute', animated: false}, count: 5, me: false};
const standardReaction = {emoji: {id: null, name: '💜', animated: false}, count: 2, me: false};

type MenuFactory = (props: {onClose: () => void}) => React.ReactElement<Record<string, any>>;

describe('right-clicking a reaction', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(async () => {
		Messages.handleLoadMessagesSuccess({
			channelId: CHANNEL_ID,
			messages: [
				{
					id: MESSAGE_ID,
					channel_id: CHANNEL_ID,
					author: {
						id: '100',
						username: 'fox',
						discriminator: '0001',
						global_name: null,
						avatar: null,
						avatar_color: null,
						flags: 0,
					},
					type: 0,
					flags: 0,
					pinned: false,
					tts: false,
					mention_everyone: false,
					mentions: [],
					mention_roles: [],
					content: 'look at this',
					timestamp: '2026-10-17T18:00:00.000Z',
					reactions: [customReaction, standardReaction],
				} as any,
			],
		});
		const message = Messages.getMessage(CHANNEL_ID, MESSAGE_ID);
		expect(message).toBeTruthy();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				<MessageReactions
					message={message!}
					data-flx="channel.message-reactions-context-menu-test.message-reactions"
				/>,
			);
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		Messages.handleSessionInvalidated();
		vi.clearAllMocks();
	});

	// Reaction buttons are labelled "<emoji>: <count>, press to add reaction", in the message's order.
	const openMenuOn = (index: number): React.ReactElement<Record<string, any>> => {
		const button = Array.from(container.querySelectorAll('button')).filter((el) =>
			el.getAttribute('aria-label')?.endsWith('press to add reaction'),
		)[index];
		expect(button).toBeTruthy();
		const event = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
		act(() => {
			button!.dispatchEvent(event);
		});
		expect(event.defaultPrevented).toBe(true);
		expect(ContextMenuCommands.openFromEvent).toHaveBeenCalledTimes(1);
		const factory = vi.mocked(ContextMenuCommands.openFromEvent).mock.calls[0][1] as unknown as MenuFactory;
		return factory({onClose: vi.fn()});
	};

	it('opens the message menu with the emoji actions for a custom emoji', () => {
		const menu = openMenuOn(0);
		expect(menu.type).toBe(MessageContextMenu);
		expect(menu.props.message.id).toBe(MESSAGE_ID);
		expect(menu.props.openReactionsTo.emoji).toEqual(customReaction.emoji);
		const emojiItems = menu.props.inlineStickerOrEmojiItems as React.ReactElement<Record<string, any>>;
		expect(emojiItems.type).toBe(EmojiInlineMenuItems);
		expect(emojiItems.props.emoji.id).toBe(customReaction.emoji.id);
		expect(emojiItems.props.messageId).toBe(MESSAGE_ID);
		expect(emojiItems.props.channelId).toBe(CHANNEL_ID);
	});

	it('opens the same message menu, without emoji actions, for a standard emoji', () => {
		const menu = openMenuOn(1);
		expect(menu.type).toBe(MessageContextMenu);
		expect(menu.props.openReactionsTo.emoji.name).toBe('💜');
		expect(menu.props.inlineStickerOrEmojiItems).toBeFalsy();
	});
});
