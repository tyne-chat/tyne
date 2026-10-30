// SPDX-License-Identifier: AGPL-3.0-or-later

import {MessageNonceRequest} from '@fluxer/schema/src/domains/message/MessageRequestSchemas';
import {SnowflakeStringType, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

// Fork: server commands, per-community slash commands whose template the server fills in
// (docs/design/server-commands.md).

export const MAX_GUILD_COMMANDS = 500;
export const MAX_GUILD_COMMAND_DESCRIPTION_LENGTH = 100;
export const MAX_GUILD_COMMAND_HINT_LENGTH = 100;
export const MAX_GUILD_COMMAND_TEMPLATE_LENGTH = 4000;
export const MAX_GUILD_COMMAND_INPUT_LENGTH = 10_000;

/**
 * The composer's draft persistence accepts only these names (`SlashSlotPersistence.ts` in the web
 * app), so the server enforces the same rule.
 */
export const GUILD_COMMAND_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** Upstream's client-side commands on the web and on phones. A community command cannot take one. */
export const RESERVED_GUILD_COMMAND_NAMES: ReadonlySet<string> = new Set([
	'shrug',
	'tableflip',
	'unflip',
	'me',
	'spoiler',
	'tts',
	'nick',
	'kick',
	'ban',
	'dm',
	'msg',
	'saved',
	'favorites',
	'sticker',
	'gif',
	'persona',
	'pagebreak',
]);

export const GuildCommandInputMode = z
	.enum(['none', 'optional', 'required'])
	.describe('Whether the command takes input: none, optional or required');
export type GuildCommandInputMode = z.infer<typeof GuildCommandInputMode>;

export const GuildCommandInputType = z.enum(['text']).describe('What the input is: free text (with mentions)');
export type GuildCommandInputType = z.infer<typeof GuildCommandInputType>;

export const GuildCommandKind = z
	.enum(['basic', 'script'])
	.describe('basic: only text and the person and input variables; script: anything else');
export type GuildCommandKind = z.infer<typeof GuildCommandKind>;

const GuildCommandNameSchema = z
	.string()
	.regex(GUILD_COMMAND_NAME_PATTERN)
	.describe('The name typed after the slash: lowercase letters, digits, - and _, at most 32 characters');

const GuildCommandTemplateSchema = z
	.string()
	.min(1)
	.max(MAX_GUILD_COMMAND_TEMPLATE_LENGTH)
	.describe('The Liquid template the server fills in when the command runs');

export const GuildCommandCreateRequestSchema = z.object({
	name: GuildCommandNameSchema,
	description: z.string().max(MAX_GUILD_COMMAND_DESCRIPTION_LENGTH).default('').describe('Shown in autocomplete'),
	template: GuildCommandTemplateSchema,
	input_mode: GuildCommandInputMode,
	input_type: GuildCommandInputType.default('text'),
	input_hint: z
		.string()
		.max(MAX_GUILD_COMMAND_HINT_LENGTH)
		.nullish()
		.describe('Placeholder shown in the input while the command is filled in'),
});
export type GuildCommandCreateRequest = z.infer<typeof GuildCommandCreateRequestSchema>;

export const GuildCommandUpdateRequestSchema = z.object({
	name: GuildCommandNameSchema.optional(),
	description: z.string().max(MAX_GUILD_COMMAND_DESCRIPTION_LENGTH).optional(),
	template: GuildCommandTemplateSchema.optional(),
	input_mode: GuildCommandInputMode.optional(),
	input_type: GuildCommandInputType.optional(),
	input_hint: z.string().max(MAX_GUILD_COMMAND_HINT_LENGTH).nullish(),
});
export type GuildCommandUpdateRequest = z.infer<typeof GuildCommandUpdateRequestSchema>;

export const GuildCommandRunRequestSchema = z.object({
	input: z
		.string()
		.max(MAX_GUILD_COMMAND_INPUT_LENGTH)
		.regex(/^[^\r\n]*$/)
		.nullish()
		.describe('What the member typed, as wire text (mentions as <@...>); one line'),
	persona_id: SnowflakeStringType.nullish().describe("One of the caller's personas to post as"),
	nonce: MessageNonceRequest,
});
export type GuildCommandRunRequest = z.infer<typeof GuildCommandRunRequestSchema>;

export const GuildCommandResponseSchema = z.object({
	id: SnowflakeStringType.describe('The ID of the command'),
	guild_id: SnowflakeStringType.describe('The community the command belongs to'),
	name: z.string(),
	description: z.string(),
	kind: GuildCommandKind,
	input_mode: GuildCommandInputMode,
	input_type: GuildCommandInputType,
	input_hint: z.string().nullable(),
	creator_id: SnowflakeStringType.describe('The member who created the command'),
	created_at: z.string().describe('ISO 8601 timestamp'),
	updated_at: z.string().describe('ISO 8601 timestamp'),
	template: z
		.string()
		.optional()
		.describe("The template; only returned to those who may edit the community's commands"),
});
export type GuildCommandResponse = z.infer<typeof GuildCommandResponseSchema>;

export const GuildCommandListResponseSchema = z.array(GuildCommandResponseSchema);

export const GuildCommandParam = z.object({
	guild_id: SnowflakeType.describe('The ID of the guild'),
	command_id: SnowflakeType.describe('The ID of the command'),
});

export const ChannelGuildCommandParam = z.object({
	channel_id: SnowflakeType.describe('The ID of the channel'),
	command_id: SnowflakeType.describe('The ID of the command'),
});
