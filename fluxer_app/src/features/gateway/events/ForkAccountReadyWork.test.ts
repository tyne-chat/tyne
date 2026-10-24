// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	AccountScopedWorkRegistry,
	AccountScopedWorkTransitionReason,
} from '@app/features/platform/state/AccountScopedWork';
import {beforeEach, describe, expect, it, vi} from 'vitest';

type TransitionHandler = Parameters<AccountScopedWorkRegistry['registerTransition']>[0];

const SWITCH: AccountScopedWorkTransitionReason = 'account-switch';

const work = vi.hoisted(() => ({
	isSuspended: false,
	transition: null as TransitionHandler | null,
}));
const calls = vi.hoisted(() => ({
	fetchPersonas: [] as Array<boolean | undefined>,
	fetchPersonaSettings: 0,
	fetchChannelStates: 0,
	invalidateSignalBar: 0,
}));

vi.mock('@app/features/platform/state/AccountScopedWork', () => ({
	AccountScopedWork: {
		get isSuspended() {
			return work.isSuspended;
		},
		registerTransition: (handler: TransitionHandler) => {
			work.transition = handler;
			return () => {};
		},
	},
}));
vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	fetchPersonas: async (force?: boolean) => {
		calls.fetchPersonas.push(force);
		return [];
	},
	fetchPersonaSettings: async () => {
		calls.fetchPersonaSettings += 1;
	},
}));
vi.mock('@app/features/persona/state/PersonaStore', () => ({
	PersonaStore: {
		fetchChannelStates: async () => {
			calls.fetchChannelStates += 1;
		},
	},
}));
vi.mock('@app/features/signal_bar/state/SignalBarStore', () => ({
	default: {
		invalidate: () => {
			calls.invalidateSignalBar += 1;
		},
	},
}));

const {handleForkPromotedResume} = await import('@app/features/gateway/events/ForkAccountReadyWork');

const requests = () => calls.fetchPersonas.length + calls.fetchPersonaSettings + calls.fetchChannelStates;

describe("the fork's READY work after upstream's promoted resume", () => {
	beforeEach(() => {
		work.isSuspended = false;
		calls.fetchPersonas = [];
		calls.fetchPersonaSettings = 0;
		calls.fetchChannelStates = 0;
		calls.invalidateSignalBar = 0;
	});

	it('loads the personas, their settings and the channel states once, as after READY', () => {
		handleForkPromotedResume();
		expect(calls.fetchPersonas).toEqual([true]);
		expect(calls.fetchPersonaSettings).toBe(1);
		expect(calls.fetchChannelStates).toBe(1);
		expect(requests()).toBe(3);
		expect(calls.invalidateSignalBar).toBe(1);
	});

	it('waits for an account switch to finish, then loads them once', () => {
		work.isSuspended = true;
		handleForkPromotedResume();
		expect(requests()).toBe(0);
		work.isSuspended = false;
		work.transition?.released?.(SWITCH);
		expect(requests()).toBe(3);
		work.transition?.released?.(SWITCH);
		expect(requests()).toBe(3);
	});

	it('drops the work when another switch starts before the first one finishes', () => {
		work.isSuspended = true;
		handleForkPromotedResume();
		work.transition?.suspend(SWITCH);
		work.isSuspended = false;
		work.transition?.released?.(SWITCH);
		expect(requests()).toBe(0);
	});
});
