// SPDX-License-Identifier: AGPL-3.0-or-later

import {getGuildSettingsTabs} from '@app/features/user/components/settings_utils/GuildSettingsConstants';
import type {I18n} from '@lingui/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const runtimeConfig = vi.hoisted(() => ({signalBarGuildId: null as string | null}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({default: runtimeConfig}));
vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));

const i18n = {_: (descriptor: {message?: string}) => descriptor.message ?? ''} as unknown as I18n;

describe('community settings signal bar tab', () => {
	beforeEach(() => {
		runtimeConfig.signalBarGuildId = null;
	});

	it('is not offered while the instance has the signal bar switched off', () => {
		const tabs = getGuildSettingsTabs(i18n);
		expect(tabs.some((tab) => tab.type === 'signal_bar')).toBe(false);
		expect(tabs.some((tab) => tab.category === 'message_tools')).toBe(false);
		expect(tabs.some((tab) => tab.type === 'overview')).toBe(true);
	});

	it('is offered in every community once the instance has a home community', () => {
		runtimeConfig.signalBarGuildId = '1546374477426720768';
		expect(getGuildSettingsTabs(i18n).some((tab) => tab.type === 'signal_bar')).toBe(true);
	});
});
