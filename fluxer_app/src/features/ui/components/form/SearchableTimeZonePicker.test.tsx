// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

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

const {SearchableTimeZonePicker} = await import('./SearchableTimeZonePicker');

describe('SearchableTimeZonePicker', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
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

	function setInputValue(input: HTMLInputElement, value: string) {
		const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
		nativeInputValueSetter?.call(input, value);
		input.dispatchEvent(new Event('input', {bubbles: true}));
		input.dispatchEvent(new Event('change', {bubbles: true}));
	}

	it('renders with resolved initial timezone when value is null and allowClear is false', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value={null}
					onChange={onChange}
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change"
				/>,
			);
		});

		const trigger = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger"]') as HTMLButtonElement;
		expect(trigger).not.toBeNull();
		expect(trigger.disabled).toBe(false);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');

		const triggerLabel = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger-label"]');
		expect(triggerLabel).not.toBeNull();
		expect(triggerLabel?.textContent?.trim().length).toBeGreaterThan(0);
	});

	it('renders "Not set" when value is null and allowClear is true', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value={null}
					onChange={onChange}
					allowClear={true}
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change--2"
				/>,
			);
		});

		const triggerLabel = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger-label"]');
		expect(triggerLabel?.textContent).toBe('Not set');
	});

	it('renders custom notSetLabel when value is null and allowClear is true', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value={null}
					onChange={onChange}
					allowClear={true}
					notSetLabel="Use Server Default"
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change--3"
				/>,
			);
		});

		const triggerLabel = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger-label"]');
		expect(triggerLabel?.textContent).toBe('Use Server Default');
	});

	it('renders matching timezone label when explicit value is provided', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value="UTC"
					onChange={onChange}
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change--4"
				/>,
			);
		});

		const triggerLabel = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger-label"]');
		expect(triggerLabel?.textContent).toContain('UTC');
	});

	it('renders label, description, and handles disabled state', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value="UTC"
					onChange={onChange}
					disabled={true}
					label="Select Timezone"
					description="Choose your local timezone for events"
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change--5"
				/>,
			);
		});

		expect(document.body.textContent).toContain('Select Timezone');
		expect(document.body.textContent).toContain('Choose your local timezone for events');

		const trigger = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger"]') as HTMLButtonElement;
		expect(trigger.disabled).toBe(true);
	});

	it('opens popout on click, sets aria-expanded true, and shows suggested and all sections', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value="UTC"
					onChange={onChange}
					allowClear={true}
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change--6"
				/>,
			);
		});

		const trigger = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger"]') as HTMLButtonElement;

		// Popout initially closed
		expect(document.querySelector('[data-flx="ui.searchable-timezone-picker.popout-wrapper"]')).toBeNull();

		// Click trigger
		await act(async () => {
			trigger.click();
		});

		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		const popout = document.querySelector('[data-flx="ui.searchable-timezone-picker.popout-wrapper"]');
		expect(popout).not.toBeNull();

		// Suggested section visible with "Not set" item
		const notSetItem = document.querySelector('[data-flx="ui.searchable-timezone-picker.not-set-item"]');
		expect(notSetItem).not.toBeNull();
		expect(notSetItem?.textContent).toContain('Not set');
	});

	it('filters options by search query and selects timezone', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value={null}
					onChange={onChange}
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change--7"
				/>,
			);
		});

		const trigger = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger"]') as HTMLButtonElement;
		await act(async () => {
			trigger.click();
		});

		const popout = document.querySelector('[data-flx="ui.searchable-timezone-picker.popout-wrapper"]');
		expect(popout).not.toBeNull();

		const searchInput = popout?.querySelector('input[type="text"]') as HTMLInputElement;
		expect(searchInput).not.toBeNull();

		// Search for Tokyo
		await act(async () => {
			setInputValue(searchInput, 'Tokyo');
		});

		const options = document.querySelectorAll('[role="option"]');
		const tokyoOption = Array.from(options).find((opt) => opt.textContent?.includes('Tokyo'));
		expect(tokyoOption).toBeDefined();

		// Click Tokyo option
		await act(async () => {
			(tokyoOption as HTMLElement).click();
		});

		expect(onChange).toHaveBeenCalledWith('Asia/Tokyo');
		// Popout should close after selection
		expect(document.querySelector('[data-flx="ui.searchable-timezone-picker.popout-wrapper"]')).toBeNull();
	});

	it('selects "Not set" to clear timezone when allowClear is enabled', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchableTimeZonePicker
					value="Asia/Tokyo"
					onChange={onChange}
					allowClear={true}
					data-flx="ui.form.searchable-time-zone-picker-test.searchable-time-zone-picker.change--8"
				/>,
			);
		});

		const trigger = document.querySelector('[data-flx="ui.searchable-timezone-picker.trigger"]') as HTMLButtonElement;
		await act(async () => {
			trigger.click();
		});

		const notSetItem = document.querySelector('[data-flx="ui.searchable-timezone-picker.not-set-item"]');
		expect(notSetItem).not.toBeNull();

		await act(async () => {
			(notSetItem as HTMLElement).click();
		});

		expect(onChange).toHaveBeenCalledWith(null);
		expect(document.querySelector('[data-flx="ui.searchable-timezone-picker.popout-wrapper"]')).toBeNull();
	});
});
