// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/user/utils/AvatarUtils', () => ({
	getUserAvatarURL: ({id, avatar}: {id: string; avatar: string}, animated: boolean) =>
		`https://media.test/avatars/${id}/${avatar}${animated ? '.gif' : '.webp'}`,
}));

const {personaAvatarUrls} = await import('@app/features/persona/utils/PersonaAvatarUrls');

describe('personaAvatarUrls', () => {
	it('gives no override without a persona, so the account avatar shows', () => {
		expect(personaAvatarUrls('1', undefined)).toEqual({});
		expect(personaAvatarUrls('1', null)).toEqual({});
	});

	it('gives no override for a persona without an avatar, which inherits the account avatar', () => {
		expect(personaAvatarUrls('1', {avatar: null})).toEqual({});
		expect(personaAvatarUrls('1', {avatar: ''})).toEqual({});
	});

	it("turns the persona's hash into a static and an animated address under the owning account", () => {
		expect(personaAvatarUrls('1', {avatar: 'a_abc123'})).toEqual({
			avatarUrl: 'https://media.test/avatars/1/a_abc123.webp',
			hoverAvatarUrl: 'https://media.test/avatars/1/a_abc123.gif',
		});
	});
});
