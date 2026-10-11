// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's REST endpoints. They live here rather than in upstream's Endpoints.ts, so that
// upstream's additions to its own list never meet the fork's.

export const ForkEndpoints = {
	CHANNEL_SIGNALS: (channelId: string) => `/channels/${channelId}/signals`,
	CHANNEL_SIGNAL: (channelId: string, signalId: string) => `/channels/${channelId}/signals/${signalId}`,
	CHANNEL_SIGNAL_ME: (channelId: string, signalId: string) => `/channels/${channelId}/signals/${signalId}/@me`,
	CHANNEL_SIGNAL_USER: (channelId: string, signalId: string, userId: string) =>
		`/channels/${channelId}/signals/${signalId}/users/${userId}`,
	CHANNEL_SIGNAL_BAR: (channelId: string) => `/channels/${channelId}/signal-bar`,
	GUILD_SIGNAL_BAR_CHANNELS: (guildId: string) => `/guilds/${guildId}/signal-bar/channels`,
	INSTANCE_SIGNAL_BAR: '/instance/signal-bar',
	CHANNEL_PERSONA_MENTIONS: (channelId: string) => `/channels/${channelId}/persona-mentions`,
	USER_PERSONAS: '/users/@me/personas',
	USER_PERSONA: (personaId: string) => `/users/@me/personas/${personaId}`,
	USER_PERSONA_IMPORT: '/users/@me/personas/import',
	USER_PUBLIC_PERSONAS: (userId: string) => `/users/${userId}/personas`,
	USER_PUBLIC_PERSONA: (userId: string, personaId: string) => `/users/${userId}/personas/${personaId}`,
	USER_PERSONA_AVATAR: '/users/@me/personas/avatar',
	USER_PERSONA_BANNER: '/users/@me/personas/banner',
	USER_PERSONA_IMPORT_AVATAR: '/users/@me/personas/import-avatar',
	USER_PERSONA_IMPORT_BATCH_AVATARS: '/users/@me/personas/import-batch-avatars',
	USER_PERSONA_SETTINGS: '/users/@me/personas/settings',
	USER_PERSONA_CHANNEL_STATES: '/users/@me/personas/channel-states',
	USER_PERSONA_CHANNEL_STATE: (channelId: string) => `/users/@me/personas/channel-states/${channelId}`,
	USER_SUBPROFILE_AVATAR: '/users/@me/subprofiles/avatar',
	USER_SUBPROFILE_BANNER: '/users/@me/subprofiles/banner',
	USER_SUBPROFILE_IMPORT_AVATAR: '/users/@me/subprofiles/import-avatar',
	USER_SUBPROFILE_IMPORT_BATCH_AVATARS: '/users/@me/subprofiles/import-batch-avatars',
} as const;
