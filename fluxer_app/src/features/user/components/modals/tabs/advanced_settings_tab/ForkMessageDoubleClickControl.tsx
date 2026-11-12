// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the switches of the "Double-click to edit" and "Double-click to reply" rows, which take the
// place of upstream's one switch for both (tyne-chat/tyne#611; the logic is in
// ForkMessageDoubleClick.ts, the rows in ForkChatSettingsIndex.ts).

import {
	getMessageDoubleClickActions,
	setMessageDoubleClickActions,
} from '@app/features/accessibility/state/ForkMessageDoubleClick';
import {Switch} from '@app/features/ui/components/form/FormSwitch';
import {
	DOUBLE_CLICK_TO_EDIT_DESCRIPTOR,
	DOUBLE_CLICK_TO_REPLY_DESCRIPTOR,
} from '@app/features/user/components/settings_utils/search_index/ForkChatSettingsIndex';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

export const ForkDoubleClickToEditControl = observer(() => {
	const {i18n} = useLingui();
	const actions = getMessageDoubleClickActions();
	return (
		<Switch
			ariaLabel={i18n._(DOUBLE_CLICK_TO_EDIT_DESCRIPTOR)}
			value={actions.edit}
			onChange={(value) => setMessageDoubleClickActions({...actions, edit: value})}
			compact
			data-flx="user.advanced-settings-tab.switch.double-click-to-edit"
		/>
	);
});

export const ForkDoubleClickToReplyControl = observer(() => {
	const {i18n} = useLingui();
	const actions = getMessageDoubleClickActions();
	return (
		<Switch
			ariaLabel={i18n._(DOUBLE_CLICK_TO_REPLY_DESCRIPTOR)}
			value={actions.reply}
			onChange={(value) => setMessageDoubleClickActions({...actions, reply: value})}
			compact
			data-flx="user.advanced-settings-tab.switch.double-click-to-reply"
		/>
	);
});
