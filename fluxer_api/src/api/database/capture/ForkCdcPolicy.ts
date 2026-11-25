// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Tyne's own tables stay out of ClickHouse; copying one is a decision for later.
export const TYNE_TABLES_LEFT_OUT: ReadonlyArray<string> = [
	'dm_signal_bar_settings',
	'guild_command_counts',
	'guild_command_ids',
	'guild_command_use_channels',
	'guild_command_uses',
	'guild_commands',
	'guild_signal_bar_settings',
	'persona_blocks',
	'persona_channel_states',
	'persona_groups',
	'persona_image_sources',
	'personas',
	'thread_owner_personas',
	'thread_owner_personas_by_user',
	'user_persona_settings',
];
