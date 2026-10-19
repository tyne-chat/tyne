// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/user/utils/AvatarUtils', () => ({
	getUserAvatarURL: ({id, avatar}: {id: string; avatar: string}, animated: boolean, size: number) =>
		`https://media.test/avatars/${id}/${avatar}${animated ? '.gif' : '.webp'}?size=${size}`,
}));

const {personaTagIconUrls} = await import('@app/features/persona/utils/PersonaTagIconUrls');

describe('personaTagIconUrls', () => {
	it("turns the icon's hash into a static and an animated address under the owning account", () => {
		expect(personaTagIconUrls('1', 'a_1a2b3c4d')).toEqual({
			staticUrl: 'https://media.test/avatars/1/a_1a2b3c4d.webp?size=32',
			hoverUrl: 'https://media.test/avatars/1/a_1a2b3c4d.gif?size=32',
		});
		expect(personaTagIconUrls('1', ' 1a2b3c4d ')?.staticUrl).toBe('https://media.test/avatars/1/1a2b3c4d.webp?size=32');
	});

	it('gives no image without an icon', () => {
		expect(personaTagIconUrls('1', null)).toBeNull();
		expect(personaTagIconUrls('1', undefined)).toBeNull();
		expect(personaTagIconUrls('1', '')).toBeNull();
	});

	it('gives no image without the owner, whose account the image is stored under', () => {
		expect(personaTagIconUrls(null, '1a2b3c4d')).toBeNull();
		expect(personaTagIconUrls(undefined, '1a2b3c4d')).toBeNull();
	});

	it.each([
		'https://tracker.example/pixel.png',
		'http://tracker.example/pixel.png',
		'//tracker.example/pixel.png',
		'data:image/png;base64,iVBORw0KGgo=',
		'icon.png',
		'🦊',
		'1A2B3C4D',
		'../1a2b3c4d',
	])('loads nothing for an icon that is not a hash: %s', (icon) => {
		expect(personaTagIconUrls('1', icon)).toBeNull();
	});
});
