// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {MessageStates} from '@fluxer/constants/src/ChannelConstants';
import {observer} from 'mobx-react-lite';
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
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
			_: (descriptor: {message?: string}) => descriptor.message ?? '',
			locale: 'en',
		},
	}),
}));

const STABLE_PERMISSIONS = {
	channel: {id: 'ch-1', guildId: 'g-1', isThread: () => false},
	isDM: false,
	canSendMessages: true,
	canAddReactions: false,
	canEditMessage: true,
	canDeleteMessage: true,
	canDeleteAttachment: true,
	canPinMessage: false,
	canForwardMessage: true,
	canCrosspostMessage: false,
	canSuppressEmbeds: false,
	shouldRenderSuppressEmbeds: false,
	canCreateThread: false,
	isPreviewing: false,
};

const STABLE_HANDLERS = {
	handleEmojiSelect: vi.fn(),
	handleCopyMessageId: vi.fn(),
	handleCopyMessage: vi.fn(),
	handleCopyMessageLink: vi.fn(),
	handleSaveMessage: vi.fn(() => vi.fn()),
	handleToggleSuppressEmbeds: vi.fn(),
	handleReply: vi.fn(),
	handlePinMessage: vi.fn(),
	handleEditMessage: vi.fn(),
	handleChangePersona: vi.fn(),
	handleForward: vi.fn(),
	handleCrosspostMessage: vi.fn(),
	handleMarkAsUnread: vi.fn(),
	handleRemoveAllReactions: vi.fn(),
	handleRetryMessage: vi.fn(),
	handleFailedMessageDelete: vi.fn(),
};

vi.mock('@app/features/channel/components/MessageActionUtils', () => ({
	canReportMessage: () => false,
	createMessageActionHandlers: () => STABLE_HANDLERS,
	getEffectiveContent: () => 'hello',
	isClientSystemMessage: () => false,
	isEmbedsSuppressed: () => false,
	requestSpeakMessage: vi.fn(),
	useMessagePermissions: () => STABLE_PERMISSIONS,
}));

vi.mock('@app/features/channel/state/QuickReactionStore', () => ({
	useQuickReactionEmojis: () => [],
}));

vi.mock('@app/features/messaging/commands/SavedMessageCommands', () => ({
	ensureAllLoaded: vi.fn(() => Promise.resolve()),
}));

vi.mock('@app/features/messaging/hooks/useMessageReactionStore', () => ({
	useMessageReactions: () => [],
}));

vi.mock('@app/features/messaging/state/SavedMessages', () => ({
	default: {isSaved: () => false},
}));

vi.mock('@app/features/permissions/state/Permission', () => ({
	default: {can: () => false},
}));

vi.mock('@app/features/user/state/UserSettings', () => ({
	default: {developerMode: false},
}));

vi.mock('@app/features/voice/utils/VoiceTtsUtils', () => ({
	default: {isSupported: () => false, isSpeaking: () => false, hasVoices: () => false},
}));

const {PersonaStore} = await import('@app/features/persona/state/PersonaStore');
const {addTestPersona} = await import('@app/features/persona/state/__fixtures__/PersonaTestFixtures');
const {messageActionMenuItemIds, useMessageActionMenuData} = await import('./MessageActionMenu');

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

describe('useMessageActionMenuData persona reactivity (tyne-chat/tyne#937)', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		PersonaStore.reset();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		PersonaStore.reset();
	});

	it('updates groups when personas load or clear even if permissions stays referentially stable', () => {
		const message = {
			id: 'msg-1',
			channelId: 'ch-1',
			state: MessageStates.SENT,
			pinned: false,
			isCrossposted: false,
			messageSnapshots: undefined,
			isCurrentUserAuthor: () => true,
			isUserMessage: () => true,
		} as unknown as Parameters<typeof useMessageActionMenuData>[0];

		let latestItemIds: Array<string> = [];
		const Probe = observer(() => {
			const {groups} = useMessageActionMenuData(message);
			latestItemIds = groups.flatMap((g) =>
				g.items.map((item) => ('id' in item ? item.id : undefined)).filter((id): id is string => Boolean(id)),
			);
			return null;
		});

		act(() => {
			root.render(createElement(Probe));
		});
		expect(latestItemIds).not.toContain(messageActionMenuItemIds.changePersona);

		act(() => {
			addTestPersona(PersonaStore, {name: 'Alice'});
		});
		expect(latestItemIds).toContain(messageActionMenuItemIds.changePersona);

		act(() => {
			PersonaStore.setPersonas([]);
		});
		expect(latestItemIds).not.toContain(messageActionMenuItemIds.changePersona);
	});
});
