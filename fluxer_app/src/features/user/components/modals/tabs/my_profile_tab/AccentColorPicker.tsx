// SPDX-License-Identifier: AGPL-3.0-or-later

import {ColorPickerField} from '@app/features/ui/components/form/ColorPickerField';
import myProfileTabStyles from '@app/features/user/components/modals/tabs/MyProfileTab.module.css';
import styles from '@app/features/user/components/modals/tabs/my_profile_tab/AccentColorPicker.module.css';
import {ACCENT_COLOR_DESCRIPTOR} from '@app/features/user/utils/UserMessageDescriptors';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

// Fork imports.

import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {useMemo} from 'react';

const DEFAULT_PROFILE_ACCENT_COLOR = 0x4641d9;

const CUSTOMIZES_THE_BORDER_AND_BANNER_COLOR_ON_YOUR_DESCRIPTOR = msg({
	message: 'Customizes the border and banner color on your profile',
	comment: 'Label in the accent color picker. Keep the tone plain and specific.',
});

interface AccentColorPickerProps {
	value: number | null;
	onChange: (value: number | null) => void;
	disabled?: boolean;
	errorMessage?: string;
	defaultColor?: number | null;
}

export const AccentColorPicker = observer(({value, onChange, disabled, errorMessage, ...f}: AccentColorPickerProps) => {
	// Fork: the fork's props; a one-letter rest keeps upstream's signature on one line.
	const {defaultColor} = f;
	const {i18n} = useLingui();
	const currentUser = Users.currentUser;
	const effectiveDefault = useMemo(() => {
		if (defaultColor != null) {
			return defaultColor;
		}
		if (currentUser && typeof currentUser.avatarColor === 'number' && currentUser.avatarColor !== 0) {
			return currentUser.avatarColor;
		}
		if (currentUser && !currentUser.avatar) {
			return AvatarUtils.getDefaultAvatarPrimaryColor(currentUser.id);
		}
		return DEFAULT_PROFILE_ACCENT_COLOR;
	}, [defaultColor, currentUser?.avatarColor, currentUser?.avatar, currentUser?.id]);

	return (
		<div data-flx="user.my-profile-tab.accent-color-picker.div">
			<ColorPickerField
				label={i18n._(ACCENT_COLOR_DESCRIPTOR)}
				description={i18n._(CUSTOMIZES_THE_BORDER_AND_BANNER_COLOR_ON_YOUR_DESCRIPTOR)}
				descriptionClassName={myProfileTabStyles.inputFooter}
				value={value ?? effectiveDefault}
				onChange={onChange}
				defaultValue={effectiveDefault}
				isDefaultValue={value === null}
				onReset={() => onChange(null)}
				disabled={disabled}
				data-flx="user.my-profile-tab.accent-color-picker.color-picker-field.change"
			/>
			{errorMessage && (
				<p className={styles.errorMessage} data-flx="user.my-profile-tab.accent-color-picker.error-message">
					{errorMessage}
				</p>
			)}
		</div>
	);
});
