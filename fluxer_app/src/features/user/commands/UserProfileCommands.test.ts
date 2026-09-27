// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {beforeEach, describe, expect, it, vi} from 'vitest';

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
	Trans: ({children}: {children?: any}) => children ?? null,
	useLingui: () => ({
		i18n: {
			_: (descriptor: any) => descriptor?.message ?? '',
			locale: 'en',
		},
	}),
}));

vi.mock('@app/features/user/components/modals/UserProfileModal', () => ({
	UserProfileModal: () => null,
}));

const {
	mockAuth,
	mockSession,
	mockInit,
	mockMobileLayout,
	mockUserProfile,
	mockUsers,
	mockPopoutCloseAll,
	mockContextMenuClose,
	mockUserProfileMobileClose,
	mockUserProfileMobileOpen,
	mockPersonaProfileMobileClose,
	mockPersonaProfileMobileOpen,
	mockModalPush,
	mockModalPopAllByType,
	mockHttpGet,
} = vi.hoisted(() => ({
	mockAuth: {
		isAuthenticated: true,
		currentUserId: '100000000000000001',
	},
	mockSession: {
		isConnected: true,
	},
	mockInit: {
		canNavigateToProtectedRoutes: true,
	},
	mockMobileLayout: {
		enabled: false,
		isMobileLayout: () => false,
	},
	mockUserProfile: {
		getProfile: vi.fn(),
		handleProfileCreate: vi.fn(),
		handleProfileInvalidate: vi.fn(),
		handleProfilesClear: vi.fn(),
	},
	mockUsers: {
		handleUserUpdate: vi.fn(),
	},
	mockPopoutCloseAll: vi.fn(),
	mockContextMenuClose: vi.fn(),
	mockUserProfileMobileClose: vi.fn(),
	mockUserProfileMobileOpen: vi.fn(),
	mockPersonaProfileMobileClose: vi.fn(),
	mockPersonaProfileMobileOpen: vi.fn(),
	mockModalPush: vi.fn(),
	mockModalPopAllByType: vi.fn(),
	mockHttpGet: vi.fn(),
}));

vi.mock('@app/features/ui/commands/PopoutCommands', () => ({
	closeAll: () => mockPopoutCloseAll(),
}));

vi.mock('@app/features/ui/commands/ContextMenuCommands', () => ({
	close: () => mockContextMenuClose(),
}));

vi.mock('@app/features/user/state/UserProfileMobile', () => ({
	default: {
		close: () => mockUserProfileMobileClose(),
		open: (...args: Array<any>) => mockUserProfileMobileOpen(...args),
	},
}));

vi.mock('@app/features/persona/state/PersonaProfileMobile', () => ({
	default: {
		close: () => mockPersonaProfileMobileClose(),
		open: (...args: Array<any>) => mockPersonaProfileMobileOpen(...args),
	},
}));

vi.mock('@app/features/ui/commands/ModalCommands', () => ({
	push: (fn: any) => mockModalPush(fn),
	popAllByType: (type: any) => mockModalPopAllByType(type),
	modal: (fn: any) => fn,
}));

vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {
		get: (...args: Array<any>) => mockHttpGet(...args),
		configure: vi.fn(),
	},
}));

vi.mock('@app/features/auth/state/Authentication', () => ({
	default: mockAuth,
}));

vi.mock('@app/features/platform/state/AuthSession', () => ({
	default: mockSession,
}));

vi.mock('@app/features/app/state/Initialization', () => ({
	default: mockInit,
}));

vi.mock('@app/features/ui/state/MobileLayout', () => ({
	default: mockMobileLayout,
}));

vi.mock('@app/features/user/state/UserProfile', () => ({
	default: mockUserProfile,
}));

vi.mock('@app/features/user/state/Users', () => ({
	default: mockUsers,
}));

import {
	canOpenUserProfileSurface,
	clearCurrentUserProfiles,
	closeUserProfileSurfaces,
	fetch,
	invalidate,
	openLinkedUserProfile,
	openUserProfile,
} from './UserProfileCommands';

describe('UserProfileCommands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuth.isAuthenticated = true;
		mockSession.isConnected = true;
		mockInit.canNavigateToProtectedRoutes = true;
		mockMobileLayout.enabled = false;
	});

	describe('canOpenUserProfileSurface', () => {
		it('returns true when authenticated, connected, and initialized', () => {
			expect(canOpenUserProfileSurface()).toBe(true);
		});

		it('returns false if not authenticated', () => {
			mockAuth.isAuthenticated = false;
			expect(canOpenUserProfileSurface()).toBe(false);
		});

		it('returns false if session is disconnected', () => {
			mockSession.isConnected = false;
			expect(canOpenUserProfileSurface()).toBe(false);
		});

		it('returns false if protected routes cannot be navigated to', () => {
			mockInit.canNavigateToProtectedRoutes = false;
			expect(canOpenUserProfileSurface()).toBe(false);
		});
	});

	describe('closeUserProfileSurfaces', () => {
		it('closes popouts, context menus, user mobile sheet, persona mobile sheet, and modals', () => {
			closeUserProfileSurfaces();

			expect(mockPopoutCloseAll).toHaveBeenCalledTimes(1);
			expect(mockContextMenuClose).toHaveBeenCalledTimes(1);
			expect(mockUserProfileMobileClose).toHaveBeenCalledTimes(1);
			expect(mockPersonaProfileMobileClose).toHaveBeenCalledTimes(1);
			expect(mockModalPopAllByType).toHaveBeenCalledTimes(1);
		});
	});

	describe('openUserProfile', () => {
		it('opens modal on desktop when protected routes are available', () => {
			mockMobileLayout.enabled = false;
			const success = openUserProfile('200000000000000001', '300000000000000001', true);

			expect(success).toBe(true);
			expect(mockModalPush).toHaveBeenCalledTimes(1);
			expect(mockUserProfileMobileOpen).not.toHaveBeenCalled();
		});

		it('opens mobile bottom sheet when MobileLayout is enabled', () => {
			mockMobileLayout.enabled = true;
			const success = openUserProfile('200000000000000001', '300000000000000001', false);

			expect(success).toBe(true);
			expect(mockUserProfileMobileOpen).toHaveBeenCalledWith('200000000000000001', '300000000000000001', false);
			expect(mockModalPush).not.toHaveBeenCalled();
		});

		it('refuses to open when canOpenUserProfileSurface is false', () => {
			mockAuth.isAuthenticated = false;
			const success = openUserProfile('200000000000000001');

			expect(success).toBe(false);
			expect(mockModalPush).not.toHaveBeenCalled();
			expect(mockUserProfileMobileOpen).not.toHaveBeenCalled();
		});
	});

	describe('fetch and caching', () => {
		it('returns cached profile without calling http if already cached', async () => {
			const cachedProfile = {userId: 'user_1'} as any;
			mockUserProfile.getProfile.mockReturnValue(cachedProfile);

			const profile = await fetch('user_1');
			expect(profile).toBe(cachedProfile);
			expect(mockHttpGet).not.toHaveBeenCalled();
		});

		it('fetches profile from backend when not cached', async () => {
			mockUserProfile.getProfile.mockReturnValue(null);
			mockHttpGet.mockResolvedValue({
				body: {
					user: {id: 'user_1', username: 'testuser'},
					badges: [],
					mutual_guilds: [],
				},
			});

			const profile = await fetch('user_1', 'guild_1');
			expect(mockHttpGet).toHaveBeenCalledWith(
				expect.stringContaining('/users/user_1/profile'),
				expect.objectContaining({
					query: expect.objectContaining({guild_id: 'guild_1'}),
				}),
			);
			expect(mockUsers.handleUserUpdate).toHaveBeenCalledWith(expect.objectContaining({id: 'user_1'}));
			expect(mockUserProfile.handleProfileCreate).toHaveBeenCalled();
			expect(profile).toBeDefined();
		});

		it('invalidates cached profile', () => {
			invalidate('user_1', 'guild_1');
			expect(mockUserProfile.handleProfileInvalidate).toHaveBeenCalledWith('user_1', 'guild_1');
		});

		it('clears current user cached profiles', () => {
			clearCurrentUserProfiles();
			expect(mockUserProfile.handleProfilesClear).toHaveBeenCalledTimes(1);
		});
	});

	describe('openLinkedUserProfile', () => {
		it('fetches profile then opens it', async () => {
			mockUserProfile.getProfile.mockReturnValue({userId: 'user_2'} as any);
			const result = await openLinkedUserProfile('user_2', 'guild_2');

			expect(result).toBe(true);
			expect(mockModalPush).toHaveBeenCalledTimes(1);
		});

		it('returns false if fetch fails', async () => {
			mockUserProfile.getProfile.mockReturnValue(null);
			mockHttpGet.mockRejectedValue(new Error('Network error'));

			const result = await openLinkedUserProfile('user_fail');
			expect(result).toBe(false);
			expect(mockModalPush).not.toHaveBeenCalled();
		});
	});
});
