// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {Channel} from '@app/features/channel/models/Channel';
import type {KeybindCommand} from '@app/features/input/state/InputKeybind';
import {MessageNotifications} from '@fluxer/constants/src/NotificationConstants';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const state = await vi.hoisted(async () => {
	const {observable} = await import('mobx');
	return {
		keybindEntry: observable({
			combo: {key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false},
		}),
		channelOverride: observable({
			message_notifications: 0,
		}),
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
			_: (descriptor: {message?: string}) => descriptor.message ?? '',
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/input/state/InputKeybind', () => ({
	default: {
		getByAction: () => state.keybindEntry,
	},
}));

vi.mock('@app/features/user/state/UserGuildSettings', () => ({
	default: {
		getChannelOverride: () => state.channelOverride,
		resolveEffectiveMessageNotifications: () => 0,
	},
}));

vi.mock('@app/lib/overlay/OverlayContextMenu', () => ({
	getNotificationSettingsLabel: () => 'All Messages',
}));

vi.mock('@app/features/ui/menu_bottom_sheet/MenuBottomSheet', () => ({
	MenuBottomSheet: ({groups}: {groups: Array<{items: Array<{label: string; selected?: boolean}>}>}) => (
		<div data-flx="ui.keybind-hint.fork-missing-observer-test.sheet">
			{groups.flatMap((group) =>
				group.items.map((item) => (
					<span
						key={item.label}
						data-selected={item.selected ? 'true' : 'false'}
						data-flx="ui.keybind-hint.fork-missing-observer-test.item"
					>
						{item.label}
					</span>
				)),
			)}
		</div>
	),
}));

const {KeybindHint} = await import('@app/features/ui/keybind_hint/KeybindHint');
const {NotificationSettingsSheet} = await import(
	'@app/features/channel/components/bottomsheets/channel_details_bottom_sheet/NotificationSettingsSheet'
);

describe('missing-observer components track MobX store mutations', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		runInAction(() => {
			state.keybindEntry.combo = {
				key: 'k',
				code: 'KeyK',
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
			};
			state.channelOverride.message_notifications = MessageNotifications.ALL_MESSAGES;
		});
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it('KeybindHint re-renders when observable Keybind combo changes', () => {
		act(() => {
			root.render(
				<KeybindHint
					action={'test-action' as KeybindCommand}
					data-flx="ui.keybind-hint.fork-missing-observer-test.hint"
				/>,
			);
		});

		expect(container.textContent).toContain('K');

		act(() => {
			runInAction(() => {
				state.keybindEntry.combo = {
					key: 'm',
					code: 'KeyM',
					ctrlKey: true,
					shiftKey: false,
					altKey: false,
					metaKey: false,
				};
			});
		});

		expect(container.textContent).toContain('M');
	});

	it('NotificationSettingsSheet updates selected level when UserGuildSettings override changes', () => {
		const channel = {id: 'ch-1', guildId: 'g-1', parentId: null} as unknown as Channel;
		act(() => {
			root.render(
				<NotificationSettingsSheet
					isOpen={true}
					onClose={() => {}}
					channel={channel}
					guildId="g-1"
					onChangeLevel={() => {}}
					onOpenGuildSettings={() => {}}
					data-flx="ui.keybind-hint.fork-missing-observer-test.notification-sheet"
				/>,
			);
		});

		const selectedLabels = () =>
			Array.from(container.querySelectorAll('[data-selected="true"]')).map((node) => node.textContent);

		expect(selectedLabels()).toEqual(['All messages']);

		act(() => {
			runInAction(() => {
				state.channelOverride.message_notifications = MessageNotifications.ONLY_MENTIONS;
			});
		});

		expect(selectedLabels()).toEqual(['Only mentions']);
	});
});
