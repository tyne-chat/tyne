// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// Fork: Advanced settings list "Double-click to edit" and "Double-click to reply" side by side, and
// not upstream's one row for both, which an appended block in ChatSettingsIndex.ts hides by its id
// (tyne-chat/tyne#611). If upstream renames that row, this fails rather than show it again.

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {i18n} from '@lingui/core';
import {describe, expect, it, vi} from 'vitest';

installVoiceMenuTestBootstrap();
i18n.loadAndActivate({locale: 'en', messages: {}});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

const {chatSettingsIndex} = await import('./ChatSettingsIndex');
const {filterAdvancedSettingItems} = await import('@app/features/user/components/settings_utils/SettingsSearchIndex');
const {COMPACT_SWITCH_CONTROL_ITEM_IDS, DIRECT_CONTROL_ITEM_IDS} = await import(
	'@app/features/user/components/modals/tabs/AdvancedSettingDirectControls'
);

describe('the double-click rows in Advanced settings', () => {
	it("hide upstream's row for both actions", () => {
		const upstream = chatSettingsIndex.find((item) => item.id === 'chat-settings-double-click-message-actions');
		expect(upstream).toBeDefined();
		const ids = filterAdvancedSettingItems('', new Set()).map((item) => item.id);
		expect(ids).not.toContain('chat-settings-double-click-message-actions');
	});

	it('list a row for each action, next to each other', () => {
		const ids = filterAdvancedSettingItems('', new Set()).map((item) => item.id);
		const edit = ids.indexOf('chat-settings-double-click-edit');
		expect(edit).toBeGreaterThanOrEqual(0);
		expect(ids[edit + 1]).toBe('chat-settings-double-click-reply');
	});

	it('are found by searching for double-click', () => {
		const ids = filterAdvancedSettingItems('double-click', new Set()).map((item) => item.id);
		expect(ids).toEqual(
			expect.arrayContaining(['chat-settings-double-click-edit', 'chat-settings-double-click-reply']),
		);
	});

	it('each have a switch that a click on the row toggles', () => {
		for (const id of ['chat-settings-double-click-edit', 'chat-settings-double-click-reply']) {
			expect(DIRECT_CONTROL_ITEM_IDS.has(id)).toBe(true);
			expect(COMPACT_SWITCH_CONTROL_ITEM_IDS.has(id)).toBe(true);
		}
	});
});
