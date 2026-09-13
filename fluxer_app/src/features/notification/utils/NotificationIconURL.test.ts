// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';
import {getNotificationIconURL} from './NotificationIconURL';

vi.mock('@app/features/member/state/GuildMembers', () => ({
	default: {
		getMember: vi.fn().mockReturnValue(null),
	},
}));

vi.mock('@app/features/ui/utils/NativeUtils', () => ({
	isDesktop: vi.fn().mockReturnValue(false),
}));

vi.mock('@app/features/user/utils/AvatarUtils', () => ({
	getUserAvatarURL: vi.fn().mockReturnValue('https://cdn.fluxer.app/avatars/user-fallback.png'),
	getUserNotificationAvatarURL: vi.fn().mockReturnValue('https://cdn.fluxer.app/avatars/user-native-fallback.png'),
	getGuildMemberDisplayAvatarURL: vi.fn().mockReturnValue('https://cdn.fluxer.app/avatars/member-fallback.png'),
	getGuildMemberNotificationAvatarURL: vi
		.fn()
		.mockReturnValue('https://cdn.fluxer.app/avatars/member-native-fallback.png'),
}));

describe('getNotificationIconURL', () => {
	const dummyUser = {id: '123456789', avatar: 'sample_avatar_hash'};

	it('returns custom avatar URL when provided as an absolute URL', () => {
		const customUrl = 'https://cdn.custom.com/persona-avatar.png';
		const result = getNotificationIconURL(dummyUser, 'guild-1', customUrl);
		expect(result).toBe(customUrl);
	});

	it('resolves relative custom avatar URL against origin', () => {
		const customUrl = '/avatars/persona-avatar.png';
		const result = getNotificationIconURL(dummyUser, 'guild-1', customUrl);
		expect(result).toContain('/avatars/persona-avatar.png');
		expect(result.startsWith('http')).toBe(true);
	});

	it('trims custom avatar URL whitespace', () => {
		const customUrl = '  https://cdn.custom.com/persona-avatar.png  ';
		const result = getNotificationIconURL(dummyUser, 'guild-1', customUrl);
		expect(result).toBe('https://cdn.custom.com/persona-avatar.png');
	});

	it('falls back to user avatar when customAvatarUrl is null, undefined, or empty', () => {
		expect(getNotificationIconURL(dummyUser, null, null)).toBe('https://cdn.fluxer.app/avatars/user-fallback.png');
		expect(getNotificationIconURL(dummyUser, null, undefined)).toBe('https://cdn.fluxer.app/avatars/user-fallback.png');
		expect(getNotificationIconURL(dummyUser, null, '')).toBe('https://cdn.fluxer.app/avatars/user-fallback.png');
		expect(getNotificationIconURL(dummyUser, null, '   ')).toBe('https://cdn.fluxer.app/avatars/user-fallback.png');
	});

	// In environments where customAvatarUrl cannot be parsed by URL (such as custom scheme or non-standard URI),
	// getNotificationIconURL safely falls back to returning the trimmed input without crashing notification toasts.
	it('returns raw trimmed URL if URL constructor throws an error', () => {
		const originalURL = globalThis.URL;
		const mockURL = vi.fn().mockImplementation(() => {
			throw new Error('Invalid URL');
		});
		globalThis.URL = mockURL as any;

		try {
			const result = getNotificationIconURL(dummyUser, null, '  malformed-url  ');
			expect(result).toBe('malformed-url');
		} finally {
			globalThis.URL = originalURL;
		}
	});

	// Desktop apps (Electron/Native) require fixed 128px notification icons (NATIVE_NOTIFICATION_ICON_CSS_SIZE)
	// instead of responsive web dimensions to prevent blurred or clipped OS notification banners.
	it('resolves native notification avatar when isDesktop is true without member', async () => {
		const {isDesktop} = await import('@app/features/ui/utils/NativeUtils');
		vi.mocked(isDesktop).mockReturnValueOnce(true);

		const result = getNotificationIconURL(dummyUser, null, null);
		expect(result).toBe('https://cdn.fluxer.app/avatars/user-native-fallback.png');
	});

	// In web browsers, guild notifications use the responsive web display avatar for the member.
	it('resolves guild member avatar when member exists and isDesktop is false', async () => {
		const GuildMembers = (await import('@app/features/member/state/GuildMembers')).default;
		const mockMember = {avatar: 'guild-avatar-1', isAvatarUnset: () => false};
		vi.mocked(GuildMembers.getMember).mockReturnValueOnce(mockMember as any);

		const result = getNotificationIconURL(dummyUser, 'guild-123', null);
		expect(result).toBe('https://cdn.fluxer.app/avatars/member-fallback.png');
	});

	// On desktop apps within a guild channel, notification icons prioritize the guild member avatar
	// formatted for native desktop notification size (128px).
	it('resolves guild member native avatar when member exists and isDesktop is true', async () => {
		const GuildMembers = (await import('@app/features/member/state/GuildMembers')).default;
		const {isDesktop} = await import('@app/features/ui/utils/NativeUtils');
		const mockMember = {avatar: 'guild-avatar-1', isAvatarUnset: () => false};
		vi.mocked(GuildMembers.getMember).mockReturnValueOnce(mockMember as any);
		vi.mocked(isDesktop).mockReturnValueOnce(true);

		const result = getNotificationIconURL(dummyUser, 'guild-123', null);
		expect(result).toBe('https://cdn.fluxer.app/avatars/member-native-fallback.png');
	});
});
