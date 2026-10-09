// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ForkAppWindowAPI} from '@fluxer/desktop_ipc/src/ForkAppWindowContract';
import type React from 'react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const state = vi.hoisted(() => ({appWindows: null as ForkAppWindowAPI | null}));

vi.mock('@app/features/ui/utils/NativeUtils', () => ({
	getElectronAPI: () => (state.appWindows == null ? null : {appWindows: state.appWindows}),
}));

const {claimNotificationAcrossWindows, openRouteInNewWindow, openRouteInNewWindowOnMiddleClick} = await import(
	'@app/features/platform/utils/ForkAppWindows'
);

function desktopAPI(overrides: Partial<ForkAppWindowAPI> = {}): ForkAppWindowAPI {
	return {
		open: vi.fn(async () => true),
		claimNotification: vi.fn(async () => true),
		reportViewedChannel: vi.fn(),
		reportAccount: vi.fn(),
		...overrides,
	};
}

function mouseEvent(button: number): React.MouseEvent {
	return {button, preventDefault: vi.fn(), stopPropagation: vi.fn()} as unknown as React.MouseEvent;
}

describe('opening a route in another window', () => {
	const windowOpen = vi.fn();

	beforeEach(() => {
		windowOpen.mockClear();
		vi.stubGlobal('window', {open: windowOpen});
	});

	afterEach(() => {
		state.appWindows = null;
		vi.unstubAllGlobals();
	});

	test('the desktop app opens another app window', () => {
		state.appWindows = desktopAPI();
		openRouteInNewWindow('/channels/1/2');
		expect(state.appWindows.open).toHaveBeenCalledWith('/channels/1/2');
		expect(windowOpen).not.toHaveBeenCalled();
	});

	test('the web app opens a new tab', () => {
		openRouteInNewWindow('/channels/1/2');
		expect(windowOpen).toHaveBeenCalledWith('/channels/1/2', '_blank');
	});

	test('a desktop window that cannot be opened does not throw', async () => {
		state.appWindows = desktopAPI({open: vi.fn(async () => Promise.reject(new Error('main process is gone')))});
		expect(() => openRouteInNewWindow('/channels/1/2')).not.toThrow();
		await Promise.resolve();
	});

	test('only a middle click opens the route, and it does not also select the item', () => {
		state.appWindows = desktopAPI();
		const left = mouseEvent(0);
		openRouteInNewWindowOnMiddleClick(left, '/channels/1/2');
		expect(state.appWindows.open).not.toHaveBeenCalled();
		expect(left.preventDefault).not.toHaveBeenCalled();
		const middle = mouseEvent(1);
		openRouteInNewWindowOnMiddleClick(middle, '/channels/1/2');
		expect(state.appWindows.open).toHaveBeenCalledWith('/channels/1/2');
		expect(middle.preventDefault).toHaveBeenCalled();
		expect(middle.stopPropagation).toHaveBeenCalled();
	});
});

describe('claiming a notification across windows', () => {
	afterEach(() => {
		state.appWindows = null;
	});

	test('with a single window, as on the web, the window always announces', async () => {
		expect(await claimNotificationAcrossWindows('message-1', 'channel-1')).toBe(true);
	});

	test('on desktop the main process decides', async () => {
		state.appWindows = desktopAPI({claimNotification: vi.fn(async () => false)});
		expect(await claimNotificationAcrossWindows('message-1', 'channel-1')).toBe(false);
		expect(state.appWindows.claimNotification).toHaveBeenCalledWith('message-1', 'channel-1');
	});

	test('an event without a channel is sent with none', async () => {
		state.appWindows = desktopAPI();
		await claimNotificationAcrossWindows('relationship_1_42');
		expect(state.appWindows.claimNotification).toHaveBeenCalledWith('relationship_1_42', null);
	});

	test('if the main process cannot answer, the notification is not lost', async () => {
		state.appWindows = desktopAPI({claimNotification: vi.fn(async () => Promise.reject(new Error('no answer')))});
		expect(await claimNotificationAcrossWindows('message-1', 'channel-1')).toBe(true);
	});
});
