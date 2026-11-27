// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {observer} from 'mobx-react-lite';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
	copy: vi.fn(async () => undefined),
}));

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

vi.mock('@app/features/ui/commands/TextCopyCommands', () => ({
	copy: mocks.copy,
}));

const {HandoffCodeDisplay} = await import('@app/features/auth/flow/HandoffCodeDisplay');
const {default: UnsavedChanges} = await import('@app/features/ui/state/UnsavedChanges');
const UnsavedChangesCommands = await import('@app/features/ui/commands/UnsavedChangesCommands');
const {useUnsavedChangesFlash} = await import('@app/features/user/hooks/useUnsavedChangesFlash');

describe('Uncaptured component timer cleanup', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it('useUnsavedChangesFlash survives its state re-render for 300ms and clears pending timers on unmount', () => {
		let latestFlash = false;
		const Probe = observer(({tabId}: {tabId: string}) => {
			latestFlash = useUnsavedChangesFlash(tabId).flashBanner;
			return <div data-flx="user.hooks.fork-uncaptured-timers-test.probe">{String(latestFlash)}</div>;
		});

		const tabId = `tab-${Math.random()}`;
		UnsavedChangesCommands.setUnsavedChanges(tabId, true);

		act(() => {
			root.render(<Probe tabId={tabId} data-flx="user.hooks.fork-uncaptured-timers-test.probe-mount" />);
		});
		expect(latestFlash).toBe(false);

		act(() => {
			UnsavedChanges.triggerFlash(tabId);
		});
		expect(latestFlash).toBe(true);
		expect(vi.getTimerCount()).toBe(1);

		// Must remain true past an immediate re-render tick, then reset cleanly at 300ms.
		act(() => {
			vi.advanceTimersByTime(100);
		});
		expect(latestFlash).toBe(true);

		act(() => {
			vi.advanceTimersByTime(200);
		});
		expect(latestFlash).toBe(false);
		expect(vi.getTimerCount()).toBe(0);

		// Now trigger and unmount before 300ms elapses: timer must be cleared.
		act(() => {
			UnsavedChanges.triggerFlash(tabId);
		});
		expect(latestFlash).toBe(true);
		expect(vi.getTimerCount()).toBe(1);

		act(() => {
			root.unmount();
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it('HandoffCodeDisplay clears its copied indicator timer when unmounted before timeout', async () => {
		act(() => {
			root.render(
				<HandoffCodeDisplay
					code="ABCD-1234"
					expiresAt={null}
					isGenerating={false}
					error={null}
					data-flx="user.hooks.fork-uncaptured-timers-test.handoff"
				/>,
			);
		});

		const button = container.querySelector('button');
		expect(button).not.toBeNull();

		await act(async () => {
			button!.click();
			await Promise.resolve();
		});

		expect(mocks.copy).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);

		act(() => {
			root.unmount();
		});
		expect(vi.getTimerCount()).toBe(0);
	});
});
