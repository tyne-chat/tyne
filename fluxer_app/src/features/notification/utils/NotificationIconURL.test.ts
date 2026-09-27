// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import GuildMembers from '@app/features/member/state/GuildMembers';
import {
	getNotificationIconURL,
	NATIVE_NOTIFICATION_ICON_CSS_SIZE,
} from '@app/features/notification/utils/NotificationIconURL';
import {isDesktop} from '@app/features/ui/utils/NativeUtils';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/member/state/GuildMembers', () => ({
	default: {
		getMember: vi.fn(),
	},
}));

vi.mock('@app/features/ui/utils/NativeUtils', () => ({
	isDesktop: vi.fn(),
}));

// Only the four functions the tests steer are replaced. Everything else is the real module,
// so a function upstream adds to it later does not break these tests.
vi.mock('@app/features/user/utils/AvatarUtils', async (importOriginal) => ({
	...(await importOriginal<typeof import('@app/features/user/utils/AvatarUtils')>()),
	getGuildMemberNotificationAvatarURL: vi.fn(),
	getGuildMemberDisplayAvatarURL: vi.fn(),
	getUserNotificationAvatarURL: vi.fn(),
	getUserAvatarURL: vi.fn(),
}));

describe('NotificationIconURL', () => {
	const mockUser = {
		id: '100000000000000001',
		avatar: 'user_avatar_hash',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDesktop).mockReturnValue(false);
	});

	describe('when customAvatarUrl is provided (persona subprofile)', () => {
		it('returns trimmed absolute URL directly', () => {
			const url = '  https://cdn.example.com/persona.png  ';
			expect(getNotificationIconURL(mockUser, 'guild_1', url)).toBe('https://cdn.example.com/persona.png');
		});

		it('resolves relative URLs against window.location.origin', () => {
			const relativeUrl = '/assets/personas/avatar123.webp';
			const result = getNotificationIconURL(mockUser, 'guild_1', relativeUrl);
			expect(result).toBe(`${window.location.origin}/assets/personas/avatar123.webp`);
		});

		it('falls back to customAvatarUrl.trim() if URL parsing throws', () => {
			const weirdUrl = 'invalid://[invalid-url';
			expect(getNotificationIconURL(mockUser, null, weirdUrl)).toBe(weirdUrl);
		});
	});

	describe('when no customAvatarUrl is provided', () => {
		const mockMember = {
			avatar: 'member_avatar_hash',
			isAvatarUnset: () => false,
		} as any;

		it('uses desktop member notification avatar on desktop when member exists', () => {
			vi.mocked(isDesktop).mockReturnValue(true);
			vi.mocked(GuildMembers.getMember).mockReturnValue(mockMember);
			vi.mocked(AvatarUtils.getGuildMemberNotificationAvatarURL).mockReturnValue('https://cdn/member_desktop.png');

			const result = getNotificationIconURL(mockUser, 'guild_1', null);

			expect(result).toBe('https://cdn/member_desktop.png');
			expect(AvatarUtils.getGuildMemberNotificationAvatarURL).toHaveBeenCalledWith({
				guildId: 'guild_1',
				userId: mockUser.id,
				avatar: mockUser.avatar,
				memberAvatar: 'member_avatar_hash',
				avatarUnset: false,
				size: NATIVE_NOTIFICATION_ICON_CSS_SIZE,
			});
		});

		it('uses web member display avatar on web when member exists', () => {
			vi.mocked(isDesktop).mockReturnValue(false);
			vi.mocked(GuildMembers.getMember).mockReturnValue(mockMember);
			vi.mocked(AvatarUtils.getGuildMemberDisplayAvatarURL).mockReturnValue('https://cdn/member_web.png');

			const result = getNotificationIconURL(mockUser, 'guild_1', undefined);

			expect(result).toBe('https://cdn/member_web.png');
			expect(AvatarUtils.getGuildMemberDisplayAvatarURL).toHaveBeenCalledWith({
				guildId: 'guild_1',
				user: mockUser,
				memberAvatar: 'member_avatar_hash',
				avatarUnset: false,
				animated: false,
			});
		});

		it('uses desktop user notification avatar on desktop when no member or guild', () => {
			vi.mocked(isDesktop).mockReturnValue(true);
			vi.mocked(GuildMembers.getMember).mockReturnValue(null);
			vi.mocked(AvatarUtils.getUserNotificationAvatarURL).mockReturnValue('https://cdn/user_desktop.png');

			const result = getNotificationIconURL(mockUser, null, null);

			expect(result).toBe('https://cdn/user_desktop.png');
			expect(AvatarUtils.getUserNotificationAvatarURL).toHaveBeenCalledWith(
				mockUser,
				NATIVE_NOTIFICATION_ICON_CSS_SIZE,
			);
		});

		it('uses web user avatar on web when no member or guild', () => {
			vi.mocked(isDesktop).mockReturnValue(false);
			vi.mocked(GuildMembers.getMember).mockReturnValue(null);
			vi.mocked(AvatarUtils.getUserAvatarURL).mockReturnValue('https://cdn/user_web.png');

			const result = getNotificationIconURL(mockUser, 'guild_1', null);

			expect(result).toBe('https://cdn/user_web.png');
			expect(AvatarUtils.getUserAvatarURL).toHaveBeenCalledWith(mockUser, false);
		});
	});
});
