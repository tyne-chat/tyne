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
		expect(tabs.filter((tab) => tab.category === 'message_tools').map((tab) => tab.type)).toEqual(['commands']);
		expect(tabs.some((tab) => tab.type === 'overview')).toBe(true);
	});

	it('always offers the Commands tab, to members who may create or manage commands', async () => {
		const {Permissions} = await import('@fluxer/constants/src/ChannelConstants');
		const commands = getGuildSettingsTabs(i18n).find((tab) => tab.type === 'commands');
		expect(commands?.category).toBe('message_tools');
		expect(commands?.permission).toEqual([Permissions.CREATE_COMMANDS, Permissions.MANAGE_COMMANDS]);
	});

	it('is offered in every community once the instance has a home community', () => {
		runtimeConfig.signalBarGuildId = '1546374477426720768';
		expect(getGuildSettingsTabs(i18n).some((tab) => tab.type === 'signal_bar')).toBe(true);
	});
});
