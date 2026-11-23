// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the switch of the "Add a space after emoji" row (tyne-chat/tyne#650; the row is in
// ForkChatSettingsIndex.ts, the behaviour in ForkEmojiComposerSpacing.ts).

import * as AccessibilityCommands from '@app/features/accessibility/commands/AccessibilityCommands';
import Accessibility from '@app/features/accessibility/state/Accessibility';
import {Switch} from '@app/features/ui/components/form/FormSwitch';
import {ADD_A_SPACE_AFTER_EMOJI_DESCRIPTOR} from '@app/features/user/components/settings_utils/search_index/ForkChatSettingsIndex';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

export const ForkSpaceAfterEmojiControl = observer(() => {
	const {i18n} = useLingui();
	return (
		<Switch
			ariaLabel={i18n._(ADD_A_SPACE_AFTER_EMOJI_DESCRIPTOR)}
			value={Accessibility.spaceAfterEmoji}
			onChange={(value) => AccessibilityCommands.update({spaceAfterEmoji: value})}
			compact
			data-flx="user.advanced-settings-tab.switch.space-after-emoji"
		/>
	);
});
