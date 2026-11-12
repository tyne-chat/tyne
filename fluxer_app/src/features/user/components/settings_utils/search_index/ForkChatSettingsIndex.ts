// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's entries of the Chat settings tab in the settings search, kept out of upstream's
// ChatSettingsIndex.ts as ForkAppearanceIndex.ts is; SettingsSearchIndex.ts spreads them right after
// upstream's.
//
// Upstream's "Double-click a message to edit or reply" is one switch for both actions; here it is a
// row for each (tyne-chat/tyne#611), and an appended block in ChatSettingsIndex.ts hides upstream's.

import type {SearchableSettingDescriptor} from '@app/features/user/components/settings_utils/search_index/SearchIndexTypes';
import {DOUBLE_CLICK_DESCRIPTOR} from '@app/features/user/components/settings_utils/section_registry/SharedDescriptors';
import {msg} from '@lingui/core/macro';

export const DOUBLE_CLICK_TO_EDIT_DESCRIPTOR = msg({
	message: 'Double-click to edit',
	comment:
		'Short label for an advanced chat preference: double-clicking one of your own messages opens it for editing.',
});
export const DOUBLE_CLICK_TO_REPLY_DESCRIPTOR = msg({
	message: 'Double-click to reply',
	comment:
		"Short label for an advanced chat preference: double-clicking someone else's message starts a reply to it. Off by default, so that double-clicking a word selects it.",
});

export const forkChatSettingsIndex: Array<SearchableSettingDescriptor> = [
	{
		id: 'chat-settings-double-click-edit',
		tabType: 'chat_settings',
		sectionId: 'input',
		label: DOUBLE_CLICK_TO_EDIT_DESCRIPTOR,
		keywords: [DOUBLE_CLICK_DESCRIPTOR],
		audience: 'advanced',
		tags: ['chat'],
	},
	{
		id: 'chat-settings-double-click-reply',
		tabType: 'chat_settings',
		sectionId: 'input',
		label: DOUBLE_CLICK_TO_REPLY_DESCRIPTOR,
		keywords: [DOUBLE_CLICK_DESCRIPTOR],
		audience: 'advanced',
		tags: ['chat'],
	},
];
