// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {describe, expect, it} from 'vitest';
import PersonaProfileMobile from './PersonaProfileMobile';

describe('PersonaProfileMobile', () => {
	const mockUser = {
		id: 'user_12345',
		username: 'testuser',
	} as unknown as User;

	const mockSubprofile: MessageSubprofileResponse = {
		id: 'sub_123',
		name: 'Caelum',
		avatar: null,
		system_name: 'Starlight',
		pronouns: 'they/them',
	};

	it('manages open and closed state cleanly', () => {
		expect(PersonaProfileMobile.isOpen).toBe(false);
		expect(PersonaProfileMobile.subprofile).toBeNull();
		expect(PersonaProfileMobile.user).toBeNull();

		PersonaProfileMobile.open(mockSubprofile, mockUser, 'guild_999');

		expect(PersonaProfileMobile.isOpen).toBe(true);
		expect(PersonaProfileMobile.subprofile).toEqual(mockSubprofile);
		expect(PersonaProfileMobile.user).toEqual(mockUser);
		expect(PersonaProfileMobile.guildId).toBe('guild_999');

		PersonaProfileMobile.close();

		expect(PersonaProfileMobile.isOpen).toBe(false);
		expect(PersonaProfileMobile.subprofile).toBeNull();
		expect(PersonaProfileMobile.user).toBeNull();
		expect(PersonaProfileMobile.guildId).toBeUndefined();
	});
});
