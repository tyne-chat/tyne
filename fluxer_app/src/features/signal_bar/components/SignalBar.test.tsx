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
	useDrag: () => [{isDragging: false}, (node: unknown) => node, (node: unknown) => node],
	useDrop: () => [{}, (node: unknown) => node],
}));
vi.mock('@app/features/ui/tooltip/Tooltip', () => ({
	Tooltip: ({children, text}: {children?: React.ReactNode; text: string | (() => React.ReactNode)}) => (
		<>
			{children}
			<span data-testid="tooltip" data-flx="signal-bar.signal-bar-test.tooltip.tooltip">
				{typeof text === 'function' ? text() : text}
			</span>
		</>
	),
}));
vi.mock('@app/features/ui/components/Avatar', () => ({
	Avatar: () => <span data-testid="badge-avatar" data-flx="signal-bar.signal-bar-test.avatar.badge-avatar" />,
}));

import type {Channel} from '@app/features/channel/models/Channel';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import SessionManager from '@app/features/platform/state/AuthSession';
import {http} from '@app/features/platform/transport/RestTransport';
import {SignalBar} from '@app/features/signal_bar/components/SignalBar';
import styles from '@app/features/signal_bar/components/SignalBar.module.css';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import type {ChannelSignalEntry, SignalBarSignal} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const READING: SignalBarSignal = {id: 'reading', emoji_id: null, emoji_name: '📖', animated: false, label: 'Reading'};
const DONE: SignalBarSignal = {id: 'done', emoji_id: null, emoji_name: '✅', animated: false, label: null};

function entry(signalId: string, userId: string, username: string): ChannelSignalEntry {
	return {
		signal_id: signalId,
		user: {
			id: userId,
			username,
			discriminator: '0001',
			avatar: null,
			flags: 0,
		} as unknown as ChannelSignalEntry['user'],
		persona_id: null,
		subprofile: null,
		activated_at: 0,
	};
}

function channel(overrides: Partial<Channel> = {}): Channel {
	return {id: 'dm', guildId: null, ownerId: null, isGroupDM: () => false, ...overrides} as unknown as Channel;
}

describe('SignalBar', () => {
	let container: HTMLDivElement;
	let root: Root;
	const getMock = vi.spyOn(http, 'get');
	const putMock = vi.spyOn(http, 'put');
	const deleteMock = vi.spyOn(http, 'delete');

	const setSignals = (signals: Array<SignalBarSignal>) =>
		runInAction(() => {
			SignalBarStore.signals = signals;
			SignalBarStore.version = 1;
			SignalBarStore.collapsed = false;
		});
	const render = async (target: Channel, entries: Array<ChannelSignalEntry> = []) => {
		getMock.mockResolvedValue({ok: true, body: {enabled: true, bar_version: 1, entries}} as never);
		await act(async () => {
			root.render(<SignalBar channel={target} attached={true} data-flx="signal-bar.signal-bar-test.signal-bar" />);
		});
	};
	const button = (label: string) =>
		Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label')?.startsWith(label));

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		getMock.mockReset();
		putMock.mockReset().mockResolvedValue({ok: true} as never);
		deleteMock.mockReset().mockResolvedValue({ok: true} as never);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it('renders nothing when no signals are configured', async () => {
		setSignals([]);
		await render(channel());
		expect(container.innerHTML).toBe('');
	});

	it('dims unlit signals and shows names and badges on lit ones', async () => {
		setSignals([READING, DONE]);
		await render(channel(), [entry('reading', '1', 'alice'), entry('reading', '2', 'bob')]);

		const reading = button('Reading');
		const done = button('✅');
		expect(reading?.getAttribute('aria-label')).toBe('Reading: alice, bob');
		const lines = Array.from(reading?.nextElementSibling?.querySelectorAll(`.${styles.tooltip} > div`) ?? []);
		expect(lines.map((line) => line.textContent)).toEqual(['Reading', 'alice', 'bob']);
		expect(reading?.querySelector(`.${styles.emojiOff}`)).toBeNull();
		expect(reading?.querySelectorAll('[data-testid="badge-avatar"]')).toHaveLength(2);
		expect(done?.getAttribute('aria-label')).toBe('✅');
		expect(done?.querySelector(`.${styles.emojiOff}`)).not.toBeNull();
		expect(done?.querySelectorAll('[data-testid="badge-avatar"]')).toHaveLength(0);
	});

	it('caps badges at three and shows the remainder', async () => {
		setSignals([READING]);
		await render(
			channel(),
			['1', '2', '3', '4', '5'].map((id) => entry('reading', id, `user${id}`)),
		);
		const reading = button('Reading');
		expect(reading?.querySelectorAll('[data-testid="badge-avatar"]')).toHaveLength(3);
		expect(reading?.textContent).toContain('+2');
	});

	it('gives the signal as the persona resolved from the composer', async () => {
		const persona = vi
			.spyOn(PersonaStore, 'getEffectivePersonaForText')
			.mockReturnValue({persona: {id: '9'} as never, isFromTag: true, isTagUnfinished: false});
		setSignals([READING]);
		await render(channel());
		await act(async () => button('Reading')?.click());
		expect(putMock).toHaveBeenCalledWith('/channels/dm/signals/reading/@me', {body: {persona_id: '9'}});
		expect(deleteMock).not.toHaveBeenCalled();
		persona.mockRestore();
	});

	it('turns the signal off when the account already has it on, whatever persona it shows', async () => {
		SessionManager.setUserId('100000000000000001');
		setSignals([READING]);
		const own = {...entry('reading', '100000000000000001', 'me'), persona_id: '9'};
		await render(channel(), [own]);
		expect(button('Reading')?.getAttribute('aria-pressed')).toBe('true');
		await act(async () => button('Reading')?.click());
		expect(deleteMock).toHaveBeenCalledWith('/channels/dm/signals/reading/@me');
		expect(putMock).not.toHaveBeenCalled();
	});

	it('does not toggle in a community channel where the user has no send permission', async () => {
		setSignals([READING]);
		await render(channel({id: 'c', guildId: 'g'} as Partial<Channel>));
		await act(async () => button('Reading')?.click());
		expect(putMock).not.toHaveBeenCalled();
	});

	it('renders nothing in a channel where the bar is switched off', async () => {
		setSignals([READING]);
		getMock.mockResolvedValue({ok: true, body: {enabled: false, bar_version: 1, entries: []}} as never);
		await act(async () => {
			root.render(
				<SignalBar
					channel={channel({id: 'off'} as Partial<Channel>)}
					attached={true}
					data-flx="signal-bar.signal-bar-test.signal-bar--2"
				/>,
			);
		});
		expect(container.innerHTML).toBe('');
	});

	it('hides the signals when collapsed and keeps the caret', async () => {
		setSignals([READING]);
		await render(channel());
		await act(async () => button('Hide signal bar')?.click());
		expect(button('Reading')).toBeUndefined();
		expect(button('Show signal bar')).toBeDefined();
	});
});
