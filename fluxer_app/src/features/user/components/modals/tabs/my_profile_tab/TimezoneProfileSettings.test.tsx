// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {ProfileFieldPrivacyFlags} from '@fluxer/constants/src/UserConstants';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

installVoiceMenuTestBootstrap();

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('framer-motion', async () => {
	const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
	return {
		...actual,
		motion: {
			div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
				<div ref={ref} data-flx="user.my-profile-tab.timezone-profile-settings-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="user.my-profile-tab.timezone-profile-settings-test.span" {...props} />
			)),
		},
	};
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: React.ReactNode}) => <>{children}</>,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}, values?: Record<string, unknown>) => {
				let msg = descriptor?.message ?? '';
				if (values) {
					for (const [k, v] of Object.entries(values)) {
						msg = msg.replace(`{${k}}`, String(v));
					}
				}
				return msg;
			},
			locale: 'en-US',
		},
	}),
}));

let pushedModalRenderer: (() => React.ReactNode) | null = null;
vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: (fn: any) => {
		pushedModalRenderer = typeof fn === 'function' ? fn : () => fn;
	},
	pop: vi.fn(),
	modal: (fn: any) => fn,
}));

const {TimezoneProfileSettings} = await import('./TimezoneProfileSettings');

describe('TimezoneProfileSettings', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		pushedModalRenderer = null;
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.replaceChildren();
	});

	it('renders section and opens modal on edit button click', async () => {
		const onTimezoneChange = vi.fn();
		const onTimezonePrivacyFlagsChange = vi.fn();

		await act(async () => {
			root.render(
				<TimezoneProfileSettings
					timezone="UTC"
					timezonePrivacyFlags={ProfileFieldPrivacyFlags.EVERYONE}
					onTimezoneChange={onTimezoneChange}
					onTimezonePrivacyFlagsChange={onTimezonePrivacyFlagsChange}
					data-flx="user.my-profile-tab.timezone-profile-settings-test.timezone-profile-settings"
				/>,
			);
		});

		expect(container.textContent).toContain('Profile local time');
		const editButton = container.querySelector('button') as HTMLButtonElement;
		expect(editButton).not.toBeNull();
		expect(editButton.textContent).toContain('Edit profile local time');

		await act(async () => {
			editButton.click();
		});

		expect(pushedModalRenderer).not.toBeNull();
	});

	it('modal renders disabled privacy switches when timezone is null', async () => {
		const onTimezoneChange = vi.fn();
		const onTimezonePrivacyFlagsChange = vi.fn();

		await act(async () => {
			root.render(
				<TimezoneProfileSettings
					timezone={null}
					timezonePrivacyFlags={0}
					onTimezoneChange={onTimezoneChange}
					onTimezonePrivacyFlagsChange={onTimezonePrivacyFlagsChange}
					data-flx="user.my-profile-tab.timezone-profile-settings-test.timezone-profile-settings--2"
				/>,
			);
		});

		const editButton = container.querySelector('button') as HTMLButtonElement;
		await act(async () => {
			editButton.click();
		});

		expect(pushedModalRenderer).not.toBeNull();
		const modalContainer = document.createElement('div');
		document.body.appendChild(modalContainer);
		const modalRoot = createRoot(modalContainer);

		await act(async () => {
			modalRoot.render(pushedModalRenderer!());
		});

		const switches = document.body.querySelectorAll('button[role="switch"]');
		expect(switches.length).toBe(3);
		// All switches should be disabled when timezone is null
		for (const sw of Array.from(switches)) {
			expect((sw as HTMLButtonElement).disabled).toBe(true);
		}

		act(() => {
			modalRoot.unmount();
		});
		modalContainer.remove();
	});

	it('modal auto-enables Everyone privacy flag when timezone changes from null to a valid timezone', async () => {
		const onTimezoneChange = vi.fn();
		const onTimezonePrivacyFlagsChange = vi.fn();

		await act(async () => {
			root.render(
				<TimezoneProfileSettings
					timezone={null}
					timezonePrivacyFlags={0}
					onTimezoneChange={onTimezoneChange}
					onTimezonePrivacyFlagsChange={onTimezonePrivacyFlagsChange}
					data-flx="user.my-profile-tab.timezone-profile-settings-test.timezone-profile-settings--3"
				/>,
			);
		});

		const editButton = container.querySelector('button') as HTMLButtonElement;
		await act(async () => {
			editButton.click();
		});

		const modalContainer = document.createElement('div');
		document.body.appendChild(modalContainer);
		const modalRoot = createRoot(modalContainer);

		await act(async () => {
			modalRoot.render(pushedModalRenderer!());
		});

		// Trigger timezone picker selection
		const tzTrigger = document.body.querySelector(
			'[data-flx="ui.searchable-timezone-picker.trigger"]',
		) as HTMLButtonElement;
		expect(tzTrigger).not.toBeNull();

		await act(async () => {
			tzTrigger.click();
		});

		const options = document.querySelectorAll('[role="option"]');
		const utcOption = Array.from(options).find((opt) => opt.textContent?.includes('UTC'));
		expect(utcOption).toBeDefined();

		await act(async () => {
			(utcOption as HTMLElement).click();
		});

		expect(onTimezoneChange).toHaveBeenCalledWith('UTC');
		// Should auto-enable EVERYONE flag
		expect(onTimezonePrivacyFlagsChange).toHaveBeenCalledWith(ProfileFieldPrivacyFlags.EVERYONE);

		act(() => {
			modalRoot.unmount();
		});
		modalContainer.remove();
	});

	it('toggles privacy flags when individual switches are clicked', async () => {
		const onTimezoneChange = vi.fn();
		const onTimezonePrivacyFlagsChange = vi.fn();

		// Start with timezone set and FRIENDS flag enabled
		await act(async () => {
			root.render(
				<TimezoneProfileSettings
					timezone="UTC"
					timezonePrivacyFlags={ProfileFieldPrivacyFlags.FRIENDS}
					onTimezoneChange={onTimezoneChange}
					onTimezonePrivacyFlagsChange={onTimezonePrivacyFlagsChange}
					data-flx="user.my-profile-tab.timezone-profile-settings-test.timezone-profile-settings--4"
				/>,
			);
		});

		const editButton = container.querySelector('button') as HTMLButtonElement;
		await act(async () => {
			editButton.click();
		});

		const modalContainer = document.createElement('div');
		document.body.appendChild(modalContainer);
		const modalRoot = createRoot(modalContainer);

		await act(async () => {
			modalRoot.render(pushedModalRenderer!());
		});

		const switches = document.body.querySelectorAll('button[role="switch"]');
		const everyoneSwitch = switches[0] as HTMLButtonElement;
		const friendsSwitch = switches[1] as HTMLButtonElement;
		const communitiesSwitch = switches[2] as HTMLButtonElement;

		expect(everyoneSwitch.getAttribute('aria-checked')).toBe('false');
		expect(friendsSwitch.getAttribute('aria-checked')).toBe('true');
		expect(communitiesSwitch.getAttribute('aria-checked')).toBe('false');

		// Toggle Community switch on
		await act(async () => {
			communitiesSwitch.click();
		});

		// Expected FRIENDS | MUTUAL_GUILDS
		const expectedFlags = ProfileFieldPrivacyFlags.FRIENDS | ProfileFieldPrivacyFlags.MUTUAL_GUILDS;
		expect(onTimezonePrivacyFlagsChange).toHaveBeenCalledWith(expectedFlags);

		act(() => {
			modalRoot.unmount();
		});
		modalContainer.remove();
	});
});
