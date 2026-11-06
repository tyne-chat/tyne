// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// The DM context menu's signal bar switch. Opening the menu loads the DM's signals to know whether
// the bar is on: "Network calls" in the root AGENTS.md asks how many requests that sends, with the
// data missing and with the request failing.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@app/features/ui/action_menu/MenuItem', () => ({
	MenuItem: ({children, onClick}: {children?: React.ReactNode; onClick?: () => void}) => (
		<button type="button" onClick={onClick} data-flx="signal-bar.signal-bar-dm-menu-item-test.menu-item.button.click">
			{children}
		</button>
	),
}));

import type {Channel} from '@app/features/channel/models/Channel';
import {http} from '@app/features/platform/transport/RestTransport';
import {SignalBarDMMenuItem} from '@app/features/signal_bar/components/SignalBarDMMenuItem';
import SignalBarStore from '@app/features/signal_bar/state/SignalBarStore';
import type {SignalBarSignal} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const READING: SignalBarSignal = {id: 'reading', emoji_id: null, emoji_name: '📖', animated: false, label: 'Reading'};

function dm(id: string): Channel {
	return {id, guildId: null, ownerId: null, isGroupDM: () => false} as unknown as Channel;
}

describe('the signal bar switch in a DM menu', () => {
	let container: HTMLDivElement;
	let root: Root;
	const getMock = vi.spyOn(http, 'get');
	const putMock = vi.spyOn(http, 'put');
	const onClose = vi.fn();

	const open = async (channelId: string) => {
		await act(async () => {
			root.render(
				<SignalBarDMMenuItem
					channel={dm(channelId)}
					onClose={onClose}
					data-flx="signal-bar.signal-bar-dm-menu-item-test.signal-bar-dm-menu-item"
				/>,
			);
		});
	};

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		onClose.mockReset();
		getMock.mockReset().mockResolvedValue({ok: true, body: {enabled: true, bar_version: 1, entries: []}} as never);
		putMock.mockReset().mockResolvedValue({ok: true, status: 204} as never);
		runInAction(() => {
			SignalBarStore.signals = [READING];
			SignalBarStore.version = 1;
		});
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it('loads the DM once when the menu opens, and not again while it stays open', async () => {
		await open('dm-1');
		await open('dm-1');

		expect(getMock.mock.calls.map(([path]) => path)).toEqual(['/channels/dm-1/signals']);
		expect(container.textContent).toBe('Turn off signal bar');
	});

	it('sends nothing and shows nothing when the instance has no signals', async () => {
		runInAction(() => {
			SignalBarStore.signals = [];
		});
		await open('dm-2');

		expect(getMock).not.toHaveBeenCalled();
		expect(container.innerHTML).toBe('');
	});

	it('does not ask again after a failed request, and offers to turn the bar on', async () => {
		getMock.mockReset().mockRejectedValue(new Error('offline'));
		await open('dm-3');
		await open('dm-3');

		expect(getMock).toHaveBeenCalledTimes(1);
		expect(container.textContent).toBe('Turn on signal bar');
	});

	it('sends one request when clicked and closes the menu', async () => {
		getMock.mockResolvedValue({ok: true, body: {enabled: false, bar_version: 1, entries: []}} as never);
		await open('dm-4');
		await act(async () => container.querySelector('button')?.click());

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(putMock.mock.calls).toEqual([['/channels/dm-4/signal-bar', {body: {enabled: true}}]]);
		expect(getMock).toHaveBeenCalledTimes(1);
	});
});
