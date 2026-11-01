// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: muting a DM changes only its row in the DM list. Its rail item looks the same, so a mention
// count shown elsewhere always has a visible source (tyne-chat/tyne#284).

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import guildStyles from '@app/features/app/components/layout/GuildsLayout.module.css';
import {DMListItem} from '@app/features/app/components/layout/sidebar_nav/GuildListDMItem';
import type {Channel} from '@app/features/channel/models/Channel';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {act, createElement, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const fixture = vi.hoisted(() => ({
	hasUnread: true,
	isMuted: false,
	mentionCount: 0,
	showFaded: false,
}));

interface ChildrenProps {
	children?: ReactNode;
	className?: string;
}

vi.mock('@lingui/core/macro', () => ({
	msg: (descriptor: unknown) => (typeof descriptor === 'string' ? {message: descriptor} : descriptor),
}));
vi.mock('@lingui/react/macro', () => ({
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));
vi.mock('framer-motion', () => ({
	AnimatePresence: ({children}: ChildrenProps) => children,
	motion: {
		div: ({children, className}: ChildrenProps) => createElement('div', {className}, children),
		span: ({className}: ChildrenProps) => createElement('span', {className}),
	},
}));

vi.mock('@app/features/accessibility/state/Accessibility', () => ({
	ACCESSIBILITY_CUSTOM_THEME_STORAGE_KEY: 'Accessibility:customThemeCss',
	ACCESSIBILITY_CUSTOM_THEME_SYNC_STORAGE_KEY: 'Accessibility:customThemeCssSyncAcrossDevices',
	default: {
		get showFadedUnreadOnMutedChannels() {
			return fixture.showFaded;
		},
		useReducedMotion: true,
	},
}));
vi.mock('@app/features/read_state/state/ReadStates', () => ({
	default: {
		getMentionCount: () => fixture.mentionCount,
		getUnreadCount: () => fixture.mentionCount,
		hasUnread: () => fixture.hasUnread,
	},
}));
vi.mock('@app/features/user/state/UserGuildSettings', () => ({
	default: {isChannelDirectlyMuted: () => fixture.isMuted},
}));
vi.mock('@app/features/user/state/Users', () => ({default: {getUser: (id: string) => ({id})}}));
vi.mock('@app/features/user/utils/NicknameUtils', () => ({getNickname: () => 'Alpha'}));
vi.mock('@app/features/channel/utils/ChannelUtils', () => ({getDMDisplayName: () => 'Alpha'}));
vi.mock('@app/features/navigation/commands/NavigationCommands', () => ({selectChannel: vi.fn()}));
vi.mock('@app/features/ui/commands/ContextMenuCommands', () => ({openFromEvent: vi.fn()}));
vi.mock('@app/features/ui/state/KeyboardMode', () => ({default: {keyboardModeEnabled: false}}));
vi.mock('@app/features/ui/utils/MobileExperience', () => ({isMobileExperienceEnabled: () => false}));
vi.mock('@app/features/voice/engine/MediaEngineFacade', () => ({
	default: {getAllVoiceStatesInChannel: () => null},
}));
vi.mock('@app/features/voice/state/CallState', () => ({default: {hasActiveCall: () => false}}));
vi.mock('@app/features/voice/components/VoiceParticipantSortUtils', () => ({
	createVoiceParticipantSortSnapshot: () => ({}),
	sortVoiceParticipantItemsWithSnapshot: () => [],
}));

vi.mock('@app/features/app/hooks/useContextMenuHoverState', () => ({useContextMenuHoverState: () => false}));
vi.mock('@app/features/app/hooks/useHover', () => ({useHover: () => [null, false]}));
vi.mock('@app/features/app/hooks/useMergeRefs', () => ({useMergeRefs: () => null}));

vi.mock('@app/features/app/components/LongPressable', () => ({
	LongPressable: ({children, className}: ChildrenProps) => createElement('div', {className}, children),
}));
vi.mock('@app/features/ui/components/MentionBadge', () => ({
	MentionBadgeAnimated: ({mentionCount}: {mentionCount: number}) =>
		mentionCount > 0 ? createElement('output', null, String(mentionCount)) : null,
}));
vi.mock('@app/features/ui/focus_ring/FocusRing', () => ({default: ({children}: ChildrenProps) => children}));
vi.mock('@app/features/ui/tooltip/Tooltip', () => ({Tooltip: ({children}: ChildrenProps) => children}));
vi.mock('@app/features/app/components/layout/sidebar_nav/VoiceBadge', () => ({VoiceBadge: () => null}));
vi.mock('@app/features/app/components/shared/GroupDMAvatar', () => ({GroupDMAvatar: () => null}));
vi.mock('@app/features/channel/components/bottomsheets/DMBottomSheet', () => ({DMBottomSheet: () => null}));
vi.mock('@app/features/ui/action_menu/DMContextMenu', () => ({DMContextMenu: () => null}));
vi.mock('@app/features/ui/action_menu/GroupDMContextMenu', () => ({GroupDMContextMenu: () => null}));
vi.mock('@app/features/ui/avatars/AvatarStack', () => ({AvatarStack: () => null}));
vi.mock('@app/features/ui/components/StatusAwareAvatar', () => ({StatusAwareAvatar: () => null}));

const channel = {id: '1000000000000000001', recipientIds: ['1000000000000000002'], type: ChannelTypes.DM};

describe.each([
	{isMuted: false, showFaded: false},
	{isMuted: false, showFaded: true},
	{isMuted: true, showFaded: false},
	{isMuted: true, showFaded: true},
])('DM rail item, muted $isMuted, faded setting $showFaded', ({isMuted, showFaded}) => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		fixture.isMuted = isMuted;
		fixture.showFaded = showFaded;
		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});

	function renderItem(mentionCount: number): void {
		fixture.mentionCount = mentionCount;
		act(() => {
			root.render(
				createElement(DMListItem, {
					channel: channel as unknown as Channel,
					isSelected: false,
					onHoverEnd: vi.fn(),
					onHoverStart: vi.fn(),
				}),
			);
		});
	}

	function expectSameLookMutedOrNot(): void {
		const label = container.querySelector('button')?.getAttribute('aria-label') ?? '';
		// Also what shows a muted case really was muted: nothing else on the item differs.
		expect(label.split(', ').includes('muted')).toBe(isMuted);
		expect(container.getElementsByClassName(guildStyles.guildIndicatorBar)).toHaveLength(1);
	}

	it('shows the mention count undimmed', () => {
		renderItem(30);

		expect(container.querySelector('output')?.textContent).toBe('30');
		expectSameLookMutedOrNot();
	});

	it('shows the unread pill without mentions', () => {
		renderItem(0);

		expect(container.querySelector('output')).toBeNull();
		expectSameLookMutedOrNot();
	});
});

describe('DM rail item styles', () => {
	it('cancels the dimming of .muted in the last rule of the file', () => {
		const css = readFileSync(resolve(import.meta.dirname, 'GuildListDMItem.module.css'), 'utf8');
		const lastMutedRule = [...css.matchAll(/\.muted\s*\{([^}]*)\}/g)].at(-1)?.[1];

		expect(lastMutedRule).toContain('opacity: 1;');
		expect(lastMutedRule).toContain('color: inherit;');
	});
});
