// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's REST endpoints. They live here rather than in upstream's Endpoints.ts, so that
// upstream's additions to its own list never meet the fork's.

export const ForkEndpoints = {
	USER_SUBPROFILE_AVATAR: '/users/@me/subprofiles/avatar',
	USER_SUBPROFILE_IMPORT_AVATAR: '/users/@me/subprofiles/import-avatar',
} as const;
