// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's REST endpoints. They live here rather than in upstream's Endpoints.ts, so that
// upstream's additions to its own list never meet the fork's.

export const ForkEndpoints = {
	USER_PERSONAS: '/users/@me/personas',
	USER_PERSONA: (personaId: string) => `/users/@me/personas/${personaId}`,
	USER_PERSONA_IMPORT: '/users/@me/personas/import',
	USER_PUBLIC_PERSONAS: (userId: string) => `/users/${userId}/personas`,
	USER_PUBLIC_PERSONA: (userId: string, personaId: string) => `/users/${userId}/personas/${personaId}`,
	USER_PERSONA_AVATAR: '/users/@me/personas/avatar',
	USER_PERSONA_IMPORT_AVATAR: '/users/@me/personas/import-avatar',
	USER_PERSONA_IMPORT_BATCH_AVATARS: '/users/@me/personas/import-batch-avatars',
	USER_SUBPROFILE_AVATAR: '/users/@me/subprofiles/avatar',
	USER_SUBPROFILE_IMPORT_AVATAR: '/users/@me/subprofiles/import-avatar',
	USER_SUBPROFILE_IMPORT_BATCH_AVATARS: '/users/@me/subprofiles/import-batch-avatars',
} as const;
