// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
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
				<div ref={ref} data-flx="channel.timestamp-modal-test.div" {...props} />
			)),
			span: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
				<span ref={ref} data-flx="channel.timestamp-modal-test.span" {...props} />
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

const mockPop = vi.fn();
vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	pop: () => mockPop(),
	push: vi.fn(),
	modal: (fn: unknown) => fn,
}));

const {TimestampModal} = await import('./TimestampModal');

describe('TimestampModal', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		mockPop.mockClear();
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

	it('renders timestamp modal with NLP input and date/time inputs', async () => {
		const onInsert = vi.fn();
		await act(async () => {
			root.render(<TimestampModal onInsert={onInsert} data-flx="channel.timestamp-modal-test.timestamp-modal" />);
		});

		const nlpInput = document.querySelector('input[type="text"]') as HTMLInputElement;
		expect(nlpInput).not.toBeNull();

		const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
		expect(dateInput).not.toBeNull();
		expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;
		expect(timeInput).not.toBeNull();
		expect(timeInput.value).toMatch(/^\d{2}:\d{2}$/);
	});

	it('submits with default combo format', async () => {
		const onInsert = vi.fn();
		await act(async () => {
			root.render(<TimestampModal onInsert={onInsert} data-flx="channel.timestamp-modal-test.timestamp-modal--2" />);
		});

		const form = document.querySelector('form') as HTMLFormElement;
		expect(form).not.toBeNull();

		await act(async () => {
			form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
		});

		expect(onInsert).toHaveBeenCalledTimes(1);
		const insertedText = onInsert.mock.calls[0][0];
		// Should match combo format: <t:EPOCH:f> (<t:EPOCH:R>)
		expect(insertedText).toMatch(/^<t:\d+:f> \(<t:\d+:R>\)$/);
		expect(mockPop).toHaveBeenCalledTimes(1);
	});

	function setInputValue(input: HTMLInputElement, value: string) {
		const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
		nativeInputValueSetter?.call(input, value);
		input.dispatchEvent(new Event('input', {bubbles: true}));
		input.dispatchEvent(new Event('change', {bubbles: true}));
	}

	it('clears NLP input when date or time is manually changed', async () => {
		const onInsert = vi.fn();
		await act(async () => {
			root.render(<TimestampModal onInsert={onInsert} data-flx="channel.timestamp-modal-test.timestamp-modal--3" />);
		});

		const nlpInput = document.querySelector('input[type="text"]') as HTMLInputElement;
		expect(nlpInput).not.toBeNull();
		await act(async () => {
			setInputValue(nlpInput, 'tomorrow at 3pm');
		});
		expect(nlpInput.value).toBe('tomorrow at 3pm');

		const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;
		expect(timeInput).not.toBeNull();
		await act(async () => {
			setInputValue(timeInput, '16:30');
		});

		// Manual edit should clear NLP input
		expect(nlpInput.value).toBe('');
	});

	it('responsively renders combobox when window height is compact', async () => {
		const originalMatchMedia = window.matchMedia;
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: query === '(max-height: 680px)',
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));

		try {
			const onInsert = vi.fn();
			await act(async () => {
				root.render(<TimestampModal onInsert={onInsert} data-flx="channel.timestamp-modal-test.timestamp-modal--4" />);
			});

			const formatCombobox = document.querySelector('[data-flx="channel.timestamp-modal.combobox.format"]');
			expect(formatCombobox).not.toBeNull();
		} finally {
			window.matchMedia = originalMatchMedia;
		}
	});

	it('responsively renders combobox when window width is narrow', async () => {
		const originalMatchMedia = window.matchMedia;
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: query === '(max-width: 520px)',
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));

		try {
			const onInsert = vi.fn();
			await act(async () => {
				root.render(<TimestampModal onInsert={onInsert} data-flx="channel.timestamp-modal-test.timestamp-modal--5" />);
			});

			const formatCombobox = document.querySelector('[data-flx="channel.timestamp-modal.combobox.format"]');
			expect(formatCombobox).not.toBeNull();
		} finally {
			window.matchMedia = originalMatchMedia;
		}
	});

	it('opens searchable timezone popout on click and allows searching and selecting a timezone', async () => {
		const onInsert = vi.fn();
		await act(async () => {
			root.render(<TimestampModal onInsert={onInsert} data-flx="channel.timestamp-modal-test.timestamp-modal--6" />);
		});

		const tzTrigger = document.querySelector(
			'[data-flx="channel.timestamp-modal.timezone-trigger"]',
		) as HTMLButtonElement;
		expect(tzTrigger).not.toBeNull();

		// Initially popout is closed
		expect(document.querySelector('[data-flx="channel.timestamp-modal.timezone-popout-wrapper"]')).toBeNull();

		// Click to open
		await act(async () => {
			tzTrigger.click();
		});

		// Popout should be open
		const popout = document.querySelector('[data-flx="channel.timestamp-modal.timezone-popout-wrapper"]');
		expect(popout).not.toBeNull();

		// Popout search input should be present
		const searchInput = popout?.querySelector('input[type="text"]') as HTMLInputElement;
		expect(searchInput).not.toBeNull();
		expect(searchInput.placeholder).toBe('Search time zones');

		// Check that Suggested section is visible when search is empty
		expect(popout?.textContent).toContain('Suggested');

		// Type search query for UTC
		await act(async () => {
			setInputValue(searchInput, 'UTC');
		});

		// Suggested section should be hidden when searching
		expect(popout?.textContent).not.toContain('Suggested');

		// Find UTC option and click it
		const options = document.querySelectorAll('[role="option"]');
		const utcOption = Array.from(options).find((opt) => opt.textContent?.includes('UTC'));
		expect(utcOption).toBeDefined();

		await act(async () => {
			(utcOption as HTMLElement).click();
		});

		// After selection, popout should close
		expect(document.querySelector('[data-flx="channel.timestamp-modal.timezone-popout-wrapper"]')).toBeNull();
		// Trigger label should now reflect UTC
		expect(tzTrigger.textContent).toContain('UTC');
	});

	it('parses relative natural language inputs and produces accurate preview text', async () => {
		const onInsert = vi.fn();
		await act(async () => {
			root.render(<TimestampModal onInsert={onInsert} data-flx="channel.timestamp-modal-test.timestamp-modal--7" />);
		});

		const nlpInput = document.querySelector('input[type="text"]') as HTMLInputElement;
		expect(nlpInput).not.toBeNull();

		const formatList = document.querySelector('[data-flx="channel.timestamp-modal.format-list"]');
		expect(formatList).not.toBeNull();

		// Test "in 10 minutes"
		await act(async () => {
			setInputValue(nlpInput, 'in 10 minutes');
		});
		expect(formatList?.textContent).toContain('in 10 minutes');

		// Test "in 10 seconds"
		await act(async () => {
			setInputValue(nlpInput, 'in 10 seconds');
		});
		expect(formatList?.textContent).toContain('in 10 seconds');

		// Test "now"
		await act(async () => {
			setInputValue(nlpInput, 'now');
		});
		expect(formatList?.textContent).toContain('(now)');
	});
});
