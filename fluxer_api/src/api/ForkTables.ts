// SPDX-License-Identifier: AGPL-3.0-or-later

import {defineTable} from '@app/api/database/CassandraTableDsl';
import {
	GUILD_COMMAND_COLUMNS,
	GUILD_COMMAND_ID_COLUMNS,
	GUILD_COMMAND_USE_CHANNEL_COLUMNS,
	GUILD_COMMAND_USE_COLUMNS,
	type GuildCommandIdRow,
	type GuildCommandRow,
	type GuildCommandUseChannelRow,
	type GuildCommandUseRow,
} from '@app/api/database/types/GuildCommandTypes';
import {
	PERSONA_CHANNEL_STATE_COLUMNS,
	PERSONA_COLUMNS,
	PERSONA_IMAGE_SOURCE_COLUMNS,
	type PersonaChannelStateRow,
	type PersonaImageSourceRow,
	type PersonaRow,
	THREAD_OWNER_PERSONA_COLUMNS,
	type ThreadOwnerPersonaRow,
	USER_PERSONA_SETTINGS_COLUMNS,
	type UserPersonaSettingsRow,
} from '@app/api/database/types/PersonaTypes';

// Fork: the fork's tables. Tables.ts re-exports them, so code imports them from there, as it does
// upstream's.

export const Personas = defineTable<PersonaRow, 'user_id' | 'persona_id', 'user_id'>({
	name: 'personas',
	columns: PERSONA_COLUMNS,
	primaryKey: ['user_id', 'persona_id'],
	partitionKey: ['user_id'],
});
export const UserPersonaSettings = defineTable<UserPersonaSettingsRow, 'user_id'>({
	name: 'user_persona_settings',
	columns: USER_PERSONA_SETTINGS_COLUMNS,
	primaryKey: ['user_id'],
});
export const ThreadOwnerPersonas = defineTable<ThreadOwnerPersonaRow, 'thread_id'>({
	name: 'thread_owner_personas',
	columns: THREAD_OWNER_PERSONA_COLUMNS,
	primaryKey: ['thread_id'],
});
export const ThreadOwnerPersonasByUser = defineTable<ThreadOwnerPersonaRow, 'user_id' | 'thread_id', 'user_id'>({
	name: 'thread_owner_personas_by_user',
	columns: THREAD_OWNER_PERSONA_COLUMNS,
	primaryKey: ['user_id', 'thread_id'],
	partitionKey: ['user_id'],
});
export const PersonaChannelStates = defineTable<PersonaChannelStateRow, 'user_id' | 'channel_id', 'user_id'>({
	name: 'persona_channel_states',
	columns: PERSONA_CHANNEL_STATE_COLUMNS,
	primaryKey: ['user_id', 'channel_id'],
	partitionKey: ['user_id'],
});
export const PersonaImageSources = defineTable<PersonaImageSourceRow, 'user_id' | 'persona_id', 'user_id'>({
	name: 'persona_image_sources',
	columns: PERSONA_IMAGE_SOURCE_COLUMNS,
	primaryKey: ['user_id', 'persona_id'],
	partitionKey: ['user_id'],
});
export const GuildCommands = defineTable<GuildCommandRow, 'guild_id' | 'command_id', 'guild_id'>({
	name: 'guild_commands',
	columns: GUILD_COMMAND_COLUMNS,
	primaryKey: ['guild_id', 'command_id'],
	partitionKey: ['guild_id'],
});
export const GuildCommandIds = defineTable<GuildCommandIdRow, 'command_id'>({
	name: 'guild_command_ids',
	columns: GUILD_COMMAND_ID_COLUMNS,
	primaryKey: ['command_id'],
});
export const GuildCommandUses = defineTable<GuildCommandUseRow, 'channel_id' | 'message_id', 'channel_id'>({
	name: 'guild_command_uses',
	columns: GUILD_COMMAND_USE_COLUMNS,
	primaryKey: ['channel_id', 'message_id'],
	partitionKey: ['channel_id'],
});
export const GuildCommandUseChannels = defineTable<GuildCommandUseChannelRow, 'channel_id'>({
	name: 'guild_command_use_channels',
	columns: GUILD_COMMAND_USE_CHANNEL_COLUMNS,
	primaryKey: ['channel_id'],
});
