// SPDX-License-Identifier: AGPL-3.0-or-later

import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/notification/utils/NotificationIconURL', () => ({
	getNotificationIconURL: vi.fn(
		({id, avatar}: {id: string; avatar: string | null}, guildId?: string | null) =>
			`icon:${id}:${avatar ?? 'default'}:${guildId ?? 'no-guild'}`,
	),
}));

const {getNotificationIconURL} = await import('@app/features/notification/utils/NotificationIconURL');
const {getPersonaNotificationIconURL} = await import('@app/features/persona/utils/PersonaNotificationIconURL');

describe('getPersonaNotificationIconURL', () => {
	const account = {id: '100000000000000001', avatar: 'account_hash'};

	beforeEach(() => {
		vi.mocked(getNotificationIconURL).mockClear();
	});

	it("gives the account's icon, guild included, without a persona", () => {
		expect(getPersonaNotificationIconURL(account, 'guild_1', null)).toBe(
			'icon:100000000000000001:account_hash:guild_1',
		);
		expect(getPersonaNotificationIconURL(account, 'guild_1', undefined)).toBe(
			'icon:100000000000000001:account_hash:guild_1',
		);
	});

	it("gives the account's icon for a persona without an avatar, which inherits it", () => {
		expect(getPersonaNotificationIconURL(account, 'guild_1', {avatar: null})).toBe(
			'icon:100000000000000001:account_hash:guild_1',
		);
	});

	it("builds the icon from the persona's hash under the owning account, with no server avatar", () => {
		expect(getPersonaNotificationIconURL(account, 'guild_1', {avatar: 'a_persona_hash'})).toBe(
			'icon:100000000000000001:a_persona_hash:no-guild',
		);
		expect(getNotificationIconURL).toHaveBeenCalledWith({id: '100000000000000001', avatar: 'a_persona_hash'});
	});
});
