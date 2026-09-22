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
			_: (descriptor: {message?: string}) => descriptor?.message ?? '',
			locale: 'en-US',
		},
	}),
}));

const mockRunAfterBottomSheetClose = vi.fn((_onClose: () => void, action: () => void) => {
	action();
});

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	runAfterBottomSheetClose: (onClose: () => void, action: () => void) => mockRunAfterBottomSheetClose(onClose, action),
	pop: vi.fn(),
	push: vi.fn(),
	modal: (fn: unknown) => fn,
}));

vi.mock('@app/features/ui/menu_bottom_sheet/MenuBottomSheet', () => ({
	MenuBottomSheet: ({
		isOpen,
		groups,
	}: {
		isOpen: boolean;
		groups: Array<{items: Array<{label: string; onClick: () => void}>}>;
	}) => {
		if (!isOpen) return null;
		return (
			<div
				data-testid="menu-bottom-sheet"
				data-flx="channel.textarea.mobile-textarea-plus-bottom-sheet-test.menu-bottom-sheet.menu-bottom-sheet"
			>
				{groups.map((group, gIdx) => (
					<div
						key={gIdx}
						data-testid="menu-group"
						data-flx="channel.textarea.mobile-textarea-plus-bottom-sheet-test.menu-bottom-sheet.menu-group"
					>
						{group.items.map((item, iIdx) => (
							<button
								key={iIdx}
								type="button"
								onClick={item.onClick}
								data-testid={`menu-item-${item.label}`}
								data-flx="channel.textarea.mobile-textarea-plus-bottom-sheet-test.menu-bottom-sheet.button.click"
							>
								{item.label}
							</button>
						))}
					</div>
				))}
			</div>
		);
	},
}));

const {MobileTextareaPlusBottomSheet} = await import('./MobileTextareaPlusBottomSheet');

describe('MobileTextareaPlusBottomSheet', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		mockRunAfterBottomSheetClose.mockClear();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it('renders Insert timestamp item and invokes ModalCommands.runAfterBottomSheetClose on click', async () => {
		const onClose = vi.fn();
		const onUploadFile = vi.fn();
		const onInsertTimestamp = vi.fn();

		await act(async () => {
			root.render(
				<MobileTextareaPlusBottomSheet
					isOpen={true}
					onClose={onClose}
					onUploadFile={onUploadFile}
					onInsertTimestamp={onInsertTimestamp}
					data-flx="channel.textarea.mobile-textarea-plus-bottom-sheet-test.mobile-textarea-plus-bottom-sheet"
				/>,
			);
		});

		const timestampButton = container.querySelector('[data-testid="menu-item-Insert timestamp"]') as HTMLButtonElement;
		expect(timestampButton).not.toBeNull();

		await act(async () => {
			timestampButton.click();
		});

		expect(mockRunAfterBottomSheetClose).toHaveBeenCalledTimes(1);
		expect(mockRunAfterBottomSheetClose).toHaveBeenCalledWith(onClose, onInsertTimestamp);
		expect(onInsertTimestamp).toHaveBeenCalledTimes(1);
	});
});
