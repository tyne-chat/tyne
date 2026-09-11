// SPDX-License-Identifier: AGPL-3.0-or-later

export const OAuth2Scopes = [
	'identify',
	'email',
	'guilds',
	'connections',
	'bot',
	'personas.read',
	'personas.write',
] as const;

export type OAuth2Scope = (typeof OAuth2Scopes)[number];
