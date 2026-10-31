// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, MessageID, UserID} from '../../BrandedTypes';

// Fork: rows of the server commands tables (docs/design/server-commands.md, "Data").

export interface GuildCommandRow {
	guild_id: GuildID;
	command_id: bigint;
	name: string;
	description: string;
	template: string;
	kind: string;
	input_mode: string;
	input_type: string;
	input_hint: string | null;
	/** JSON list of the command's counters; `GuildCommandCounters.ts` reads it. */
	counters?: string | null;
	creator_id: UserID;
	created_at: Date;
	updated_at: Date;
}

export const GUILD_COMMAND_COLUMNS = [
	'guild_id',
	'command_id',
	'name',
	'description',
	'template',
	'kind',
	'input_mode',
	'input_type',
	'input_hint',
	'counters',
	'creator_id',
	'created_at',
	'updated_at',
] as const satisfies ReadonlyArray<keyof GuildCommandRow>;

/** One count of a counter. */
export interface GuildCommandCountRow {
	guild_id: GuildID;
	command_id: bigint;
	counter_id: bigint;
	scope_key: string;
	value: number;
	updated_ms: bigint;
}

export const GUILD_COMMAND_COUNT_COLUMNS = [
	'guild_id',
	'command_id',
	'counter_id',
	'scope_key',
	'value',
	'updated_ms',
] as const satisfies ReadonlyArray<keyof GuildCommandCountRow>;

/** Finds a command's community from its id alone, for the run route. */
export interface GuildCommandIdRow {
	command_id: bigint;
	guild_id: GuildID;
}

export const GUILD_COMMAND_ID_COLUMNS = ['command_id', 'guild_id'] as const satisfies ReadonlyArray<
	keyof GuildCommandIdRow
>;

/** One row per message a command made. The command's name is copied so the chip outlives a rename. */
export interface GuildCommandUseRow {
	channel_id: ChannelID;
	message_id: MessageID;
	guild_id: GuildID;
	command_id: bigint;
	command_name: string;
	created_at: Date;
}

export const GUILD_COMMAND_USE_COLUMNS = [
	'channel_id',
	'message_id',
	'guild_id',
	'command_id',
	'command_name',
	'created_at',
] as const satisfies ReadonlyArray<keyof GuildCommandUseRow>;

/** A marker per channel in which a command has ever been used, so message reads elsewhere skip the lookup. */
export interface GuildCommandUseChannelRow {
	channel_id: ChannelID;
	since: Date;
}

export const GUILD_COMMAND_USE_CHANNEL_COLUMNS = ['channel_id', 'since'] as const satisfies ReadonlyArray<
	keyof GuildCommandUseChannelRow
>;
