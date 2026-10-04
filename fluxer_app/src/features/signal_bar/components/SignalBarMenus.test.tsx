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
			_: (descriptor: {message?: string}, values?: Record<string, string>) =>
				(descriptor.message ?? '').replace(/\{(\w+)\}/g, (_match, key: string) => values?.[key] ?? ''),
			locale: 'en',
		},
	}),
}));
vi.mock('react-dnd', () => ({
	DndProvider: ({children}: {children?: React.ReactNode}) => children,
	useDrag: () => [{isDragging: false}, (node: unknown) => node, (node: unknown) => node],
	useDrop: () => [{}, (node: unknown) => node],
}));
vi.mock('react-dnd-html5-backend', () => ({HTML5Backend: {}}));
vi.mock('@app/features/ui/action_menu/MenuGroup', () => ({
	MenuGroup: ({children}: {children?: React.ReactNode}) => (
		<div data-flx="signal-bar.signal-bar-menus-test.menu-group.div">{children}</div>
	),
}));
vi.mock('@app/features/ui/action_menu/MenuItem', () => ({
	MenuItem: ({children, disabled, onClick}: {children?: React.ReactNode; disabled?: boolean; onClick?: () => void}) => (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			data-flx="signal-bar.signal-bar-menus-test.menu-item.button.click"
		>
			{children}
		</button>
	),
}));
vi.mock('@app/features/ui/action_menu/ContextMenuIcons', () => ({DeleteIcon: () => null}));
vi.mock('@app/features/ui/popover/PopoverPopout', () => ({
	Popout: ({children}: {children?: React.ReactNode}) => children,
}));
vi.mock('@app/features/expressions/components/popouts/ExpressionPickerPopout', () => ({
	ExpressionPickerPopout: () => null,
}));
vi.mock('@app/features/ui/button/Button', () => ({
	Button: ({children, onClick, disabled}: {children?: React.ReactNode; onClick?: () => void; disabled?: boolean}) => (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			data-flx="signal-bar.signal-bar-menus-test.button.button.click"
		>
			{children}
		</button>
	),
}));
vi.mock('@app/features/ui/components/form/FormInput', () => ({
	Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
		<input data-flx="signal-bar.signal-bar-menus-test.input.input" {...props} />
	),
}));

import Authentication from '@app/features/auth/state/Authentication';
import {http} from '@app/features/platform/transport/RestTransport';
import {GuildSignalBarTab} from '@app/features/signal_bar/components/GuildSignalBarTab';
import {SignalContextMenu} from '@app/features/signal_bar/components/SignalContextMenu';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import type {ChannelSignalEntry, SignalBarSignal} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const READING: SignalBarSignal = {id: 'reading', emoji_id: null, emoji_name: '📖', animated: false, label: 'Reading'};
const DONE: SignalBarSignal = {id: 'done', emoji_id: null, emoji_name: '✅', animated: false, label: null};
const ME = '100000000000000001';

function entry(userId: string, username: string, personaName?: string): ChannelSignalEntry {
	return {
		signal_id: 'reading',
		user: {
			id: userId,
			username,
			discriminator: '0001',
			avatar: null,
			flags: 0,
		} as unknown as ChannelSignalEntry['user'],
		persona_id: personaName ? '9' : null,
		subprofile: personaName ? ({id: '9', name: personaName} as ChannelSignalEntry['subprofile']) : null,
		activated_at: 0,
	};
}

describe('signal bar menus', () => {
	let container: HTMLDivElement;
	let root: Root;
	const getMock = vi.spyOn(http, 'get');
	const putMock = vi.spyOn(http, 'put');
	const deleteMock = vi.spyOn(http, 'delete');
	const buttons = () => Array.from(container.querySelectorAll('button'));
	const labelled = (text: string) => buttons().find((node) => node.textContent === text);

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		Authentication.setUserId(ME);
		getMock.mockReset().mockResolvedValue({ok: false} as never);
		putMock.mockReset().mockResolvedValue({ok: false} as never);
		deleteMock.mockReset().mockResolvedValue({ok: true} as never);
		runInAction(() => {
			SignalBarStore.signals = [READING, DONE];
			SignalBarStore.version = 1;
		});
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	const loadEntries = async (entries: Array<ChannelSignalEntry>) => {
		getMock.mockResolvedValueOnce({ok: true, body: {bar_version: 1, entries}} as never);
		await SignalBarStore.fetchChannel('c');
	};

	it('lists who is on, offers turn-off only for your own entry, and reset only to moderators', async () => {
		await loadEntries([entry('2', 'bob'), entry(ME, 'me', 'Kitsune')]);
		const onClose = vi.fn();
		await act(async () => {
			root.render(
				<SignalContextMenu
					channelId="c"
					guildId={null}
					signal={READING}
					canReset={false}
					onClose={onClose}
					data-flx="signal-bar.signal-bar-menus-test.signal-context-menu"
				/>,
			);
		});
		expect(labelled('bob')?.disabled).toBe(true);
		expect(labelled('Reset signal for everyone')).toBeUndefined();

		await act(async () => labelled('Turn off Kitsune')?.click());
		expect(onClose).toHaveBeenCalled();
		expect(deleteMock).toHaveBeenCalledWith('/channels/c/signals/reading/@me');
	});

	it('resets the signal for everyone when a moderator chooses reset', async () => {
		await loadEntries([entry('2', 'bob')]);
		await act(async () => {
			root.render(
				<SignalContextMenu
					channelId="c"
					guildId="g"
					signal={READING}
					canReset={true}
					onClose={() => {}}
					data-flx="signal-bar.signal-bar-menus-test.signal-context-menu--2"
				/>,
			);
		});
		await act(async () => labelled('Reset signal for everyone')?.click());
		expect(deleteMock).toHaveBeenCalledWith('/channels/c/signals/reading');
	});

	it('says so when nobody has the signal on', async () => {
		await loadEntries([]);
		await act(async () => {
			root.render(
				<SignalContextMenu
					channelId="c"
					guildId={null}
					signal={READING}
					canReset={true}
					onClose={() => {}}
					data-flx="signal-bar.signal-bar-menus-test.signal-context-menu--3"
				/>,
			);
		});
		expect(labelled('Nobody has this signal on')?.disabled).toBe(true);
		expect(labelled('Reset signal for everyone')).toBeUndefined();
	});

	it('saves the remaining signals when one is removed in settings', async () => {
		await act(async () => {
			root.render(<GuildSignalBarTab guildId="g" data-flx="signal-bar.signal-bar-menus-test.guild-signal-bar-tab" />);
		});
		const removeButtons = buttons().filter((node) => node.textContent === 'Remove');
		expect(removeButtons).toHaveLength(2);
		await act(async () => removeButtons[0]?.click());
		expect(putMock).toHaveBeenCalledWith('/instance/signal-bar', {
			body: {signals: [{id: 'done', emoji_id: null, emoji_name: '✅', label: null}]},
		});
	});
});
