// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ForkAppWindowAPI} from '@fluxer/desktop_ipc/src/ForkAppWindowContract';
import {observable, runInAction} from 'mobx';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const SETTLE_MS = 750;

const state = vi.hoisted(() => ({
	appWindows: null as ForkAppWindowAPI | null,
	session: null as unknown as {
		authenticated: boolean;
		accountKey: string | null;
		suspended: boolean;
		focused: boolean;
		viewedChannelId: string | null;
	},
}));

state.session = observable({
	authenticated: false,
	accountKey: null as string | null,
	suspended: false,
	focused: true,
	viewedChannelId: null as string | null,
});

vi.mock('@app/features/ui/utils/NativeUtils', () => ({
	getElectronAPI: () => (state.appWindows == null ? null : {appWindows: state.appWindows}),
}));
vi.mock('@app/features/auth/state/Accounts', () => ({
	default: {
		get currentAccountKey() {
			return state.session.accountKey;
		},
	},
}));
vi.mock('@app/features/auth/state/Authentication', () => ({
	default: {
		get isAuthenticated() {
			return state.session.authenticated;
		},
	},
}));
vi.mock('@app/features/platform/state/AccountScopedWork', () => ({
	AccountScopedWork: {
		get isSuspended() {
			return state.session.suspended;
		},
	},
}));

const reportAccount = vi.fn();
const reportViewedChannel = vi.fn();

function update(change: Partial<typeof state.session>): void {
	runInAction(() => {
		Object.assign(state.session, change);
	});
}

// The bridge starts once per document, so every test shares the one started here.
beforeEach(async () => {
	vi.useFakeTimers();
	state.appWindows ??= {
		open: vi.fn(async () => true),
		claimNotification: vi.fn(async () => true),
		reportViewedChannel,
		reportAccount,
	};
	const {startForkAppWindowBridge} = await import('@app/features/platform/utils/ForkAppWindowBridge');
	startForkAppWindowBridge({
		isFocused: () => state.session.focused,
		getViewedChannelId: () => state.session.viewedChannelId,
	});
	vi.advanceTimersByTime(SETTLE_MS);
	reportAccount.mockClear();
	reportViewedChannel.mockClear();
});

afterEach(() => {
	update({authenticated: false, accountKey: null, suspended: false, focused: true, viewedChannelId: null});
	vi.advanceTimersByTime(SETTLE_MS);
	vi.useRealTimers();
});

describe('reporting the signed-in account', () => {
	test('an account is reported once it has held for a moment', () => {
		update({authenticated: true, accountKey: 'account-a'});
		expect(reportAccount).not.toHaveBeenCalled();
		vi.advanceTimersByTime(SETTLE_MS);
		expect(reportAccount).toHaveBeenCalledExactlyOnceWith('account-a');
	});

	test('a stored account that is not signed in counts as signed out', () => {
		update({authenticated: true, accountKey: 'account-a'});
		vi.advanceTimersByTime(SETTLE_MS);
		reportAccount.mockClear();
		update({authenticated: false});
		vi.advanceTimersByTime(SETTLE_MS);
		expect(reportAccount).toHaveBeenCalledExactlyOnceWith(null);
	});

	test('the in-between states of an account switch are never reported', () => {
		update({authenticated: true, accountKey: 'account-a'});
		vi.advanceTimersByTime(SETTLE_MS);
		reportAccount.mockClear();
		update({suspended: true});
		update({authenticated: false, accountKey: null});
		vi.advanceTimersByTime(SETTLE_MS * 10);
		update({authenticated: true, accountKey: 'account-b'});
		vi.advanceTimersByTime(SETTLE_MS * 10);
		expect(reportAccount).not.toHaveBeenCalled();
		update({suspended: false});
		vi.advanceTimersByTime(SETTLE_MS);
		expect(reportAccount).toHaveBeenCalledExactlyOnceWith('account-b');
	});

	test('a state that changes again before it has settled is not reported', () => {
		update({authenticated: true, accountKey: 'account-a'});
		vi.advanceTimersByTime(SETTLE_MS - 1);
		update({accountKey: 'account-b'});
		vi.advanceTimersByTime(SETTLE_MS);
		expect(reportAccount).toHaveBeenCalledExactlyOnceWith('account-b');
	});
});

describe('reporting the channel in view', () => {
	test('the channel is reported while the window has focus and cleared when it loses it', () => {
		update({viewedChannelId: 'channel-1'});
		expect(reportViewedChannel).toHaveBeenLastCalledWith('channel-1');
		update({focused: false});
		expect(reportViewedChannel).toHaveBeenLastCalledWith(null);
		update({viewedChannelId: 'channel-2'});
		expect(reportViewedChannel).toHaveBeenCalledTimes(2);
		update({focused: true});
		expect(reportViewedChannel).toHaveBeenLastCalledWith('channel-2');
	});
});
