// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: the "Double-click to edit" and "Double-click to reply" switches each change their own
// action and leave the other as it is (tyne-chat/tyne#611).

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import type React from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

installVoiceMenuTestBootstrap();

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: React.ReactNode}) => <>{children}</>,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor?.message ?? '', locale: 'en-US'}}),
}));

const mocks = vi.hoisted(() => ({
	actions: {edit: false, reply: false},
	set: vi.fn(),
}));

vi.mock('@app/features/accessibility/state/ForkMessageDoubleClick', () => ({
	getMessageDoubleClickActions: () => mocks.actions,
	setMessageDoubleClickActions: mocks.set,
}));

const {ForkDoubleClickToEditControl, ForkDoubleClickToReplyControl} = await import('./ForkMessageDoubleClickControl');

describe('the double-click switches', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		mocks.set.mockClear();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	function render(actions: {edit: boolean; reply: boolean}): void {
		mocks.actions = actions;
		act(() => {
			root.render(
				<>
					<ForkDoubleClickToEditControl data-flx="user.advanced-settings-tab.fork-message-double-click-control-test.fork-double-click-to-edit-control" />
					<ForkDoubleClickToReplyControl data-flx="user.advanced-settings-tab.fork-message-double-click-control-test.fork-double-click-to-reply-control" />
				</>,
			);
		});
	}

	function toggle(label: string): HTMLButtonElement {
		const button = container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`);
		if (button == null) throw new Error(`no switch labelled "${label}"`);
		return button;
	}

	it('shows each action as on or off', () => {
		render({edit: true, reply: false});
		expect(toggle('Double-click to edit').getAttribute('aria-checked')).toBe('true');
		expect(toggle('Double-click to reply').getAttribute('aria-checked')).toBe('false');
	});

	it('turns replying on and leaves editing on', () => {
		render({edit: true, reply: false});
		act(() => toggle('Double-click to reply').click());
		expect(mocks.set).toHaveBeenCalledExactlyOnceWith({edit: true, reply: true});
	});

	it('turns editing off and leaves replying on', () => {
		render({edit: true, reply: true});
		act(() => toggle('Double-click to edit').click());
		expect(mocks.set).toHaveBeenCalledExactlyOnceWith({edit: false, reply: true});
	});

	it('turns editing on and leaves replying off', () => {
		render({edit: false, reply: false});
		act(() => toggle('Double-click to edit').click());
		expect(mocks.set).toHaveBeenCalledExactlyOnceWith({edit: true, reply: false});
	});
});
