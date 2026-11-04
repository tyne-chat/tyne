// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const runtimeConfig = vi.hoisted(() => ({mediaEndpoint: 'https://media.test'}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({default: runtimeConfig}));

const {toOriginalImageUrl} = await import('@app/features/user/utils/ForkOriginalImageUrl');
const AvatarUtils = await import('@app/features/user/utils/AvatarUtils');

describe('toOriginalImageUrl', () => {
	beforeEach(() => {
		runtimeConfig.mediaEndpoint = 'https://media.test';
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('turns an avatar or banner copy into the stored image', () => {
		expect(toOriginalImageUrl('https://media.test/avatars/1/abcdef12.webp?size=160')).toBe(
			'https://media.test/avatars/1/abcdef12.png?original=true',
		);
		expect(toOriginalImageUrl('https://media.test/banners/1/abcdef12.webp?size=1024')).toBe(
			'https://media.test/banners/1/abcdef12.png?original=true',
		);
		expect(toOriginalImageUrl('https://media.test/avatars/1/a_abcdef12.webp?size=160&animated=true')).toBe(
			'https://media.test/avatars/1/a_abcdef12.png?original=true',
		);
	});

	it('does the same for server profiles', () => {
		expect(toOriginalImageUrl('https://media.test/guilds/2/users/1/avatars/abcdef12.webp?size=160')).toBe(
			'https://media.test/guilds/2/users/1/avatars/abcdef12.png?original=true',
		);
		expect(toOriginalImageUrl('https://media.test/guilds/2/users/1/banners/abcdef12.webp?size=1024')).toBe(
			'https://media.test/guilds/2/users/1/banners/abcdef12.png?original=true',
		);
	});

	it('keeps a media endpoint that has a path', () => {
		runtimeConfig.mediaEndpoint = 'https://chat.test/media/';
		expect(toOriginalImageUrl('https://chat.test/media/avatars/1/abcdef12.webp?size=160')).toBe(
			'https://chat.test/media/avatars/1/abcdef12.png?original=true',
		);
		expect(toOriginalImageUrl('https://chat.test/avatars/1/abcdef12.webp')).toBe(
			'https://chat.test/avatars/1/abcdef12.webp',
		);
	});

	it('leaves everything else alone', () => {
		for (const url of [
			'',
			'blob:https://app.test/0b8f7c1e',
			'data:image/png;base64,iVBORw0KGgo=',
			'/assets/avatars/0.png',
			'https://elsewhere.test/avatars/1/abcdef12.webp',
			'https://media.test/emojis/123.webp?size=96',
			'https://media.test/icons/1/abcdef12.webp?size=96',
			'https://media.test/attachments/1/2/cat.png',
			'https://media.test/avatars/1/abcdef12',
			'not a url',
		]) {
			expect(toOriginalImageUrl(url)).toBe(url);
		}
		expect(toOriginalImageUrl(null)).toBeNull();
	});

	it("rewrites the addresses upstream's builders make", () => {
		vi.stubGlobal('window', {location: new URL('https://app.test/')});
		const user = {id: '1', avatar: 'abcdef12'};
		const built = [
			AvatarUtils.getUserAvatarURL(user, false, 160),
			AvatarUtils.getUserAvatarURL({id: '1', avatar: 'a_abcdef12'}, true, 160),
			AvatarUtils.getUserBannerURL({id: '1', banner: 'abcdef12'}, false, 1024),
			AvatarUtils.getGuildMemberAvatarURL({guildId: '2', userId: '1', avatar: null, memberAvatar: 'abcdef12'}),
			AvatarUtils.getPersonaAvatarURL({userId: '1', avatar: 'abcdef12'}),
			AvatarUtils.getPersonaBannerURL({userId: '1', banner: 'abcdef12'}),
		];
		for (const url of built) {
			const original = toOriginalImageUrl(url);
			expect(original, url).not.toBe(url);
			expect(new URL(original).searchParams.get('original'), url).toBe('true');
			expect(new URL(original).pathname, url).toBe(new URL(url).pathname.replace(/\.[a-z]+$/, '.png'));
		}
	});
});
