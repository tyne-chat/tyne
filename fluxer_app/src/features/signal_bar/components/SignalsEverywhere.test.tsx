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
			_: (descriptor: {message?: string}, values?: Record<string, string | number>) =>
				(descriptor.message ?? '')
					.replace(/\{count, plural, one \{# chat\} other \{# chats\}\}/, () => `${values?.count} chats`)
					.replace(/\{(\w+)\}/g, (_match, key: string) => String(values?.[key] ?? '')),
			locale: 'en',
		},
	}),
}));
vi.mock('react-dnd', () => ({
	useDrag: () => [{isDragging: false}, (node: unknown) => node, (node: unknown) => node],
	useDrop: () => [{}, (node: unknown) => node],
}));
vi.mock('@app/features/ui/tooltip/Tooltip', () => ({
	Tooltip: ({children}: {children?: React.ReactNode}) => children,
}));
vi.mock('@app/features/ui/popover/PopoverPopout', () => ({
	Popout: ({children, tooltip}: {children?: React.ReactNode; tooltip?: string}) => (
		<span data-tooltip={tooltip} data-flx="signal-bar.signals-everywhere-test.popout">
			{children}
		</span>
	),
}));
vi.mock('@app/features/channel/components/ChannelOriginIcon', () => ({
	ChannelOriginIcon: () => <span data-flx="signal-bar.signals-everywhere-test.origin-icon" />,
}));

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import SessionManager from '@app/features/platform/state/AuthSession';
import {http} from '@app/features/platform/transport/RestTransport';
import {SignalBar, signalsWrapBesidePair} from '@app/features/signal_bar/components/SignalBar';
import styles from '@app/features/signal_bar/components/SignalBar.module.css';
import {SignalsEverywherePanel} from '@app/features/signal_bar/components/SignalsEverywherePanel';
import {UserAreaSignalsRow} from '@app/features/signal_bar/components/UserAreaSignalsRow';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import type {SignalBarSignal, UserSignalsResponse} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {runInAction} from 'mobx';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const ME = '1';
const SLEEPING: SignalBarSignal = {
	id: 'sleeping',
	emoji_id: null,
	emoji_name: '💤',
	animated: false,
	label: 'Sleeping',
	everywhere: true,
};
const READING: SignalBarSignal = {
	id: 'reading',
	emoji_id: null,
	emoji_name: '📖',
	animated: false,
	label: 'Reading',
	everywhere: false,
};

// Real channels in the store: two community channels for the rows, and a group DM as the open chat.
const WIRE_CHANNELS = [
	{id: 'art', type: 0, guild_id: 'g', name: 'art', position: 0},
	{id: 'lore', type: 0, guild_id: 'g', name: 'lore', position: 1},
	{id: 'open', type: 3, name: 'open', recipients: [], owner_id: ME},
];

function channel(id: string): Channel {
	const found = Channels.getChannel(id);
	if (!found) throw new Error(`No channel ${id}`);
	return found;
}

const summary = (chats: UserSignalsResponse['chats'], restoreAvailable = false): UserSignalsResponse => ({
	chats,
	restore_available: restoreAvailable,
});

describe('signals everywhere on the web', () => {
	let container: HTMLDivElement;
	let root: Root;
	const getMock = vi.spyOn(http, 'get');
	const putMock = vi.spyOn(http, 'put');
	const navigate = vi.spyOn(NavigationCommands, 'selectChannel').mockImplementation(() => {});

	const render = async (node: React.ReactNode) => {
		await act(async () => root.render(node));
	};
	const buttons = () => Array.from(container.querySelectorAll('button'));
	const button = (label: string) => buttons().find((node) => node.getAttribute('aria-label')?.startsWith(label));
	const setSummary = async (response: UserSignalsResponse) => {
		getMock.mockImplementation(((path: string) =>
			Promise.resolve({
				ok: true,
				body: path === ForkEndpoints.USER_SIGNALS ? response : {enabled: true, bar_version: 1, entries: []},
			})) as never);
		await SignalBarStore.fetchMyChats();
	};

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		SessionManager.setUserId(ME);
		getMock.mockReset();
		putMock.mockReset().mockResolvedValue({ok: true, body: summary([], true)} as never);
		navigate.mockClear();
		for (const wire of WIRE_CHANNELS) Channels.handleChannelCreate({channel: wire as never});
		SignalBarStore.forgetMyChats();
		SignalBarStore.handleEnabledUpdate({channel_id: 'open', enabled: true});
		runInAction(() => {
			SignalBarStore.signals = [READING, SLEEPING];
			SignalBarStore.version = 1;
			SignalBarStore.collapsed = false;
		});
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it('counts the chats with your signals on the globe, grey at zero, and leaves chats it does not know out', async () => {
		await setSummary(
			summary([
				{channel_id: 'art', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 2},
				{channel_id: 'unknown', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 1},
			]),
		);
		await render(
			<SignalBar channel={channel('open')} attached={true} data-flx="signal-bar.signals-everywhere-test.bar" />,
		);

		const globe = button('Your signals everywhere');
		expect(globe?.getAttribute('aria-label')).toBe('Your signals everywhere · 1 chats');
		expect(globe?.querySelector(`.${styles.globeCount}`)?.textContent).toBe('1');
		expect(globe?.querySelector(`.${styles.globeCountZero}`)).toBeNull();

		await act(async () => {
			await setSummary(summary([]));
		});
		expect(button('Your signals everywhere')?.querySelector(`.${styles.globeCountZero}`)?.textContent).toBe('0');
	});

	it('shows no globe when the bar is collapsed with nothing lit in this chat, and keeps it with something lit', async () => {
		await setSummary(summary([]));
		runInAction(() => {
			SignalBarStore.collapsed = true;
		});
		await render(
			<SignalBar channel={channel('open')} attached={true} data-flx="signal-bar.signals-everywhere-test.bar" />,
		);
		expect(button('Your signals everywhere')).toBeUndefined();
		expect(button('Show signal bar')).toBeDefined();

		await act(async () => {
			SignalBarStore.handleChannelUpdate({
				channel_id: 'open',
				bar_version: 1,
				added: [
					{
						signal_id: 'reading',
						user: {id: '2', username: 'two', discriminator: '0001'} as never,
						persona_id: null,
						subprofile: null,
						activated_at: 1,
					},
				],
				removed: [],
			});
		});
		expect(button('Your signals everywhere')).toBeDefined();
	});

	it('offers only ticked signals, counts the open chat, and sets one in a single request with its persona', async () => {
		await setSummary(
			summary([
				{channel_id: 'art', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 3},
				{channel_id: 'lore', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 2},
			]),
		);
		SignalBarStore.setComposerPersona('open', {id: '7'} as never);
		await render(
			<SignalsEverywherePanel
				channel={channel('open')}
				onClose={() => {}}
				data-flx="signal-bar.signals-everywhere-test.panel"
			/>,
		);

		expect(container.textContent).toContain('Set everywhere (3 chats)');
		expect(button('Set Sleeping everywhere')).toBeDefined();
		expect(button('Set Reading everywhere')).toBeUndefined();

		await act(async () => button('Set Sleeping everywhere')?.click());

		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock).toHaveBeenCalledWith(ForkEndpoints.USER_SIGNALS, {
			body: {signal_id: 'sleeping', channel_id: 'open', persona_id: '7'},
		});
	});

	it('lists chats newest first with the same signal columns, and opens one on click', async () => {
		await setSummary(
			summary([
				{channel_id: 'lore', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 2},
				{
					channel_id: 'art',
					signals: [
						{signal_id: 'reading', persona_id: null},
						{signal_id: 'sleeping', persona_id: null},
					],
					updated_at: 5,
				},
			]),
		);
		const onClose = vi.fn();
		await render(
			<SignalsEverywherePanel channel={null} onClose={onClose} data-flx="signal-bar.signals-everywhere-test.panel" />,
		);

		const rows = Array.from(container.querySelectorAll('[data-flx="signal-bar.signals-everywhere-panel.row"]'));
		expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['art, Reading, Sleeping', 'lore, Reading']);
		const columns = Array.from(
			container.querySelectorAll<HTMLElement>('[data-flx="signal-bar.signals-everywhere-panel.row.signals"]'),
		).map((node) => node.style.gridTemplateColumns);
		expect(new Set(columns).size).toBe(1);
		expect(columns[0]).toContain('repeat(2');

		await act(async () => (rows[1] as HTMLButtonElement).click());
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith('g', 'lore');
	});

	it('turns all off with one request, and keeps Restore off until there is something to restore', async () => {
		await setSummary(
			summary([{channel_id: 'art', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 1}]),
		);
		await render(
			<SignalsEverywherePanel channel={null} onClose={() => {}} data-flx="signal-bar.signals-everywhere-test.panel" />,
		);

		const restore = buttons().find((node) => node.textContent === 'Restore…');
		expect(restore?.disabled).toBe(true);

		await act(async () =>
			buttons()
				.find((node) => node.textContent === 'Turn all off')
				?.click(),
		);
		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock).toHaveBeenCalledWith(ForkEndpoints.USER_SIGNALS, {body: {signal_id: null}});
		expect(buttons().find((node) => node.textContent === 'Restore…')?.disabled).toBe(false);
	});

	it('shows the profile popout row while signals are on anywhere or there is something to restore', async () => {
		const ActionButton = React.forwardRef<HTMLButtonElement, {label: React.ReactNode}>(({label}, ref) => (
			<button ref={ref} type="button" data-flx="signal-bar.signals-everywhere-test.action-button">
				{label}
			</button>
		));
		await setSummary(summary([]));
		await render(
			<UserAreaSignalsRow ActionButton={ActionButton as never} data-flx="signal-bar.signals-everywhere-test.row" />,
		);
		expect(container.textContent).toBe('');

		await act(async () => {
			await setSummary(summary([], true));
		});
		expect(container.textContent).toBe('Signals');

		await act(async () => {
			await setSummary(
				summary([{channel_id: 'art', signals: [{signal_id: 'reading', persona_id: null}], updated_at: 1}]),
			);
		});
		expect(container.textContent).toBe('Signals');
	});
});

describe('where the globe and caret go', () => {
	// Desktop sizes: 42px signals 12px apart, a 1px divider with 12px after it, a 28px globe and a 20px
	// caret 4px apart. Ten signals take 528px; with the gaps, the divider and the pair, 605px.
	const widths = (inner: number, count: number) =>
		signalsWrapBesidePair({inner, count, size: 42, signalGap: 12, barGap: 12, divider: 13, pair: 52});

	it('keeps them side by side while the signals fit on one row beside them, and stacks them when not', () => {
		expect(widths(605, 10)).toBe(false);
		expect(widths(604, 10)).toBe(true);
		expect(widths(400, 16)).toBe(true);
	});

	it('never stacks without signals', () => {
		expect(widths(10, 0)).toBe(false);
	});
});
