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
});
