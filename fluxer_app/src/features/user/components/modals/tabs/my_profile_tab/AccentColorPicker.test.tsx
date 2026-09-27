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

const mockCurrentUser: {
	id: string;
	avatar: string | null;
	avatarColor: number | null;
} = {
	id: '123456789012345678',
	avatar: null,
	avatarColor: null,
};

vi.mock('@app/features/user/state/Users', () => ({
	default: {
		get currentUser() {
			return mockCurrentUser;
		},
	},
}));

let lastRenderedColorPickerProps: any = null;
vi.mock('@app/features/ui/components/form/ColorPickerField', () => ({
	ColorPickerField: (props: any) => {
		lastRenderedColorPickerProps = props;
		return (
			<div
				data-testid="color-picker-field"
				data-flx="user.my-profile-tab.accent-color-picker-test.color-picker-field.color-picker-field"
			>
				<button
					type="button"
					onClick={() => props.onChange(0x112233)}
					data-flx="user.my-profile-tab.accent-color-picker-test.color-picker-field.button.change"
				>
					Change
				</button>
				<button
					type="button"
					onClick={props.onReset}
					data-flx="user.my-profile-tab.accent-color-picker-test.color-picker-field.button.reset"
				>
					Reset
				</button>
			</div>
		);
	},
}));

const {AccentColorPicker} = await import('./AccentColorPicker');

describe('AccentColorPicker', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		lastRenderedColorPickerProps = null;
		mockCurrentUser.id = '123456789012345678';
		mockCurrentUser.avatar = null;
		mockCurrentUser.avatarColor = null;

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

	it('uses explicit defaultColor when provided', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<AccentColorPicker
					value={null}
					onChange={onChange}
					defaultColor={0xabcdef}
					data-flx="user.my-profile-tab.accent-color-picker-test.accent-color-picker.change"
				/>,
			);
		});

		expect(lastRenderedColorPickerProps.defaultValue).toBe(0xabcdef);
		expect(lastRenderedColorPickerProps.value).toBe(0xabcdef);
		expect(lastRenderedColorPickerProps.isDefaultValue).toBe(true);
	});

	it('uses currentUser.avatarColor when available and defaultColor is null', async () => {
		mockCurrentUser.avatarColor = 0x55aa33;
		const onChange = vi.fn();

		await act(async () => {
			root.render(
				<AccentColorPicker
					value={null}
					onChange={onChange}
					data-flx="user.my-profile-tab.accent-color-picker-test.accent-color-picker.change--2"
				/>,
			);
		});

		expect(lastRenderedColorPickerProps.defaultValue).toBe(0x55aa33);
		expect(lastRenderedColorPickerProps.value).toBe(0x55aa33);
	});

	it('uses default avatar primary color when user has no avatar and no avatarColor', async () => {
		mockCurrentUser.avatar = null;
		mockCurrentUser.avatarColor = null;
		const onChange = vi.fn();

		await act(async () => {
			root.render(
				<AccentColorPicker
					value={null}
					onChange={onChange}
					data-flx="user.my-profile-tab.accent-color-picker-test.accent-color-picker.change--3"
				/>,
			);
		});

		expect(typeof lastRenderedColorPickerProps.defaultValue).toBe('number');
		expect(lastRenderedColorPickerProps.defaultValue).toBeGreaterThan(0);
	});

	it('falls back to DEFAULT_PROFILE_ACCENT_COLOR (0x4641d9) when user has avatar and no avatarColor', async () => {
		mockCurrentUser.avatar = 'custom_avatar_hash';
		mockCurrentUser.avatarColor = null;
		const onChange = vi.fn();

		await act(async () => {
			root.render(
				<AccentColorPicker
					value={null}
					onChange={onChange}
					data-flx="user.my-profile-tab.accent-color-picker-test.accent-color-picker.change--4"
				/>,
			);
		});

		// 0x4641d9 = 4604377
		expect(lastRenderedColorPickerProps.defaultValue).toBe(0x4641d9);
	});

	it('passes explicit value and indicates isDefaultValue false', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<AccentColorPicker
					value={0xff0000}
					onChange={onChange}
					defaultColor={0x00ff00}
					data-flx="user.my-profile-tab.accent-color-picker-test.accent-color-picker.change--5"
				/>,
			);
		});

		expect(lastRenderedColorPickerProps.value).toBe(0xff0000);
		expect(lastRenderedColorPickerProps.defaultValue).toBe(0x00ff00);
		expect(lastRenderedColorPickerProps.isDefaultValue).toBe(false);
	});

	it('handles onReset by calling onChange with null', async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<AccentColorPicker
					value={0xff0000}
					onChange={onChange}
					defaultColor={0x00ff00}
					data-flx="user.my-profile-tab.accent-color-picker-test.accent-color-picker.change--6"
				/>,
			);
		});

		act(() => {
			lastRenderedColorPickerProps.onReset();
		});

		expect(onChange).toHaveBeenCalledWith(null);
	});
});
