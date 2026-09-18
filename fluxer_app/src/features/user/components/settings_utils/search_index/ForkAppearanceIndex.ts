// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's entries of the Appearance tab in the settings search. They live here rather than
// in upstream's AppearanceIndex.ts, so that upstream's additions to its own list never meet the
// fork's; SettingsSearchIndex.ts spreads them right after upstream's.

import type {SearchableSettingDescriptor} from '@app/features/user/components/settings_utils/search_index/SearchIndexTypes';
import {msg} from '@lingui/core/macro';

const AUTO_PEEK_HIDDEN_SIDEBARS_DESCRIPTOR = msg({
	message: 'Auto-peek hidden sidebars',
	comment: 'Settings section label in Advanced Settings for edge hover peek preference.',
});
const AUTO_PEEK_HIDDEN_SIDEBARS_DESCRIPTION_DESCRIPTOR = msg({
	message: 'Hover near window edges to temporarily reveal collapsed panels.',
	comment: 'Settings section description in Advanced Settings for edge hover peek preference.',
});
const TASKBAR_DESCRIPTOR = msg({
	message: 'Taskbar',
	comment: 'Settings search synonym.',
});
const AUTO_HIDE_DESCRIPTOR = msg({
	message: 'Auto-hide',
	comment: 'Settings search synonym.',
});
const PEEK_DESCRIPTOR = msg({
	message: 'Peek',
	comment: 'Settings search synonym.',
});
export const forkAppearanceIndex: Array<SearchableSettingDescriptor> = [
	{
		id: 'appearance-edge-hover-peek',
		tabType: 'appearance',
		sectionId: 'interface',
		label: AUTO_PEEK_HIDDEN_SIDEBARS_DESCRIPTOR,
		keywords: [TASKBAR_DESCRIPTOR, AUTO_HIDE_DESCRIPTOR, PEEK_DESCRIPTOR],
		description: AUTO_PEEK_HIDDEN_SIDEBARS_DESCRIPTION_DESCRIPTOR,
		audience: 'advanced',
		tags: ['appearance'],
	},
];
