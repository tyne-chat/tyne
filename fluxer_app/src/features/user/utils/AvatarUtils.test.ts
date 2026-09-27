// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import {getEmojiOriginalURL, getPersonaAvatarURL, getPersonaBannerURL} from '@app/features/user/utils/AvatarUtils';

describe('AvatarUtils - Persona & Asset URLs', () => {
	describe('getPersonaAvatarURL', () => {
		it('returns empty string when avatar is undefined or empty', () => {
			expect(getPersonaAvatarURL({userId: '123', avatar: undefined})).toBe('');
			expect(getPersonaAvatarURL({userId: '123', avatar: null})).toBe('');
			expect(getPersonaAvatarURL({userId: '123', avatar: ''})).toBe('');
		});

		it('preserves direct HTTP, HTTPS, and data URIs without modification', () => {
			const httpUrl = 'http://example.com/avatar.png';
			const httpsUrl = 'https://cdn.example.com/avatar.webp';
			const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA';

			expect(getPersonaAvatarURL({userId: '123', avatar: httpUrl})).toBe(httpUrl);
			expect(getPersonaAvatarURL({userId: '123', avatar: httpsUrl})).toBe(httpsUrl);
			expect(getPersonaAvatarURL({userId: '123', avatar: dataUri})).toBe(dataUri);
		});

		it('formats uploaded hash into media URL using user ID', () => {
			const hash = 'a_abcdef0123456789abcdef0123456789';
			const result = getPersonaAvatarURL({userId: '987654321', avatar: hash});
			expect(result).toContain('987654321');
			expect(result).toContain('abcdef0123456789abcdef0123456789');
		});
	});

	describe('getPersonaBannerURL', () => {
		it('returns empty string when banner is undefined or empty', () => {
			expect(getPersonaBannerURL({userId: '123', banner: undefined})).toBe('');
			expect(getPersonaBannerURL({userId: '123', banner: null})).toBe('');
			expect(getPersonaBannerURL({userId: '123', banner: ''})).toBe('');
		});

		it('preserves direct HTTP, HTTPS, and data URIs', () => {
			const httpsUrl = 'https://cdn.example.com/banner.png';
			expect(getPersonaBannerURL({userId: '123', banner: httpsUrl})).toBe(httpsUrl);
		});

		it('formats uploaded banner hash into media URL', () => {
			const hash = 'banner_hash_123';
			const result = getPersonaBannerURL({userId: '987654321', banner: hash});
			expect(result).toContain('987654321');
			expect(result).toContain(hash);
		});
	});

	describe('getEmojiOriginalURL', () => {
		it('returns empty string when emoji ID is empty', () => {
			expect(getEmojiOriginalURL({id: ''})).toBe('');
		});

		it('constructs static emoji URL when animated is false or undefined', () => {
			const url = getEmojiOriginalURL({id: 'emoji_123'});
			expect(url).toContain('emojis/emoji_123.png');
		});

		it('constructs animated emoji GIF URL when animated is true', () => {
			const url = getEmojiOriginalURL({id: 'emoji_456', animated: true});
			expect(url).toContain('emojis/emoji_456.gif');
		});

		it('caches and returns identical URL on subsequent calls', () => {
			const first = getEmojiOriginalURL({id: 'cached_emoji'});
			const second = getEmojiOriginalURL({id: 'cached_emoji'});
			expect(first).toBe(second);
		});
	});
});
