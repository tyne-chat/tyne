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
export const MAX_GUILD_COMMAND_COUNTERS = 5;

/** A counter's name is a variable in the template, so it follows the same rules as one. */
export const GUILD_COMMAND_COUNTER_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export const RESERVED_GUILD_COMMAND_COUNTER_NAMES: ReadonlySet<string> = new Set([
	'person',
	'input',
	'target',
	'channel',
	'community',
	'true',
	'false',
	'nil',
	'null',
	'blank',
	'empty',
]);

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
]);

/**
 * The tags a template may use: the server's engine allows only these, and the editors suggest them.
 * `#` is an inline comment; `random` is the fork's.
 */
export const GUILD_COMMAND_TEMPLATE_TAGS: ReadonlyArray<string> = [
	'#',
	'assign',
	'capture',
	'case',
	'comment',
	'echo',
	'if',
	'liquid',
	'random',
	'raw',
	'unless',
];

/**
 * The filters a template may use: text, numbers and short lists, plus the fork's `one_of`, `plural`
 * and `ordinal`. Left out of Liquid's: what needs a loop or objects to be of use (`map`, `where`,
 * `group_by` and the `_exp` family, which also run an expression per item), hashes, JSON dumps, and
 * HTML filters, as a message is not HTML.
 */
export const GUILD_COMMAND_TEMPLATE_FILTERS: ReadonlyArray<string> = [
	'abs',
	'append',
	'at_least',
	'at_most',
	'capitalize',
	'ceil',
	'compact',
	'concat',
	'date',
	'default',
	'divided_by',
	'downcase',
	'first',
	'floor',
	'join',
	'last',
	'lstrip',
	'minus',
	'modulo',
	'one_of',
	'ordinal',
	'plural',
	'plus',
	'prepend',
	'remove',
	'remove_first',
	'remove_last',
	'replace',
	'replace_first',
	'replace_last',
	'reverse',
	'round',
	'rstrip',
	'size',
	'slice',
	'sort',
	'split',
	'strip',
	'strip_newlines',
	'times',
	'truncate',
	'truncatewords',
	'uniq',
	'upcase',
	'url_encode',
];

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

const BASIC_TEMPLATE_OUTPUT = /\{\{\s*(?:person|input)\s*\}\}/g;

/**
 * A template is basic when it is only text and the outputs `{{ person }}` and `{{ input }}`; anything
 * else is a script. The server stores this and the settings editors pick their form from it.
 */
export function classifyGuildCommandTemplate(template: string): GuildCommandKind {
	const rest = template.replace(BASIC_TEMPLATE_OUTPUT, '');
	return rest.includes('{{') || rest.includes('{%') ? 'script' : 'basic';
}

export const GuildCommandCounterPart = z
	.enum(['person', 'target', 'channel'])
	.describe('What a count is kept per: the person running it, the person mentioned, or the channel');
export type GuildCommandCounterPart = z.infer<typeof GuildCommandCounterPart>;

export const GuildCommandCounterIdentity = z
	.enum(['persona', 'account'])
	.describe('Whether a persona counts as its own person, or as its account');
export type GuildCommandCounterIdentity = z.infer<typeof GuildCommandCounterIdentity>;

export const GuildCommandCounterInputSchema = z.object({
	id: SnowflakeStringType.nullish().describe('Keeps the counts of an existing counter; empty for a new one'),
	name: z.string().min(1).max(32).describe('The name the template reads it by'),
	per: z.array(GuildCommandCounterPart).max(3).describe('What the count is kept per; empty for one count'),
	identity: GuildCommandCounterIdentity.default('persona'),
});
export type GuildCommandCounterInput = z.infer<typeof GuildCommandCounterInputSchema>;

export const GuildCommandCounterSchema = z.object({
	id: SnowflakeStringType.describe('The ID of the counter'),
	name: z.string(),
	per: z.array(GuildCommandCounterPart),
	identity: GuildCommandCounterIdentity,
});

export const GuildCommandTemplateIssueCode = z
	.enum(['unknown_tag', 'unknown_filter', 'not_closed', 'too_long', 'too_large', 'too_slow', 'invalid', 'failed'])
	.describe(
		'unknown_tag, unknown_filter: not one of the template language; not_closed: a tag or output with no end; too_long: the template; too_large: the text it builds; too_slow: it ran out of time; invalid: it cannot be read; failed: it stopped while running',
	);
export type GuildCommandTemplateIssueCode = z.infer<typeof GuildCommandTemplateIssueCode>;

export const GuildCommandTemplateIssueSchema = z.object({
	code: GuildCommandTemplateIssueCode,
	line: z.number().int().nullable().describe('The line of the problem, counted from 1, when it has one'),
	column: z.number().int().nullable().describe('The column of the problem, counted from 1, when it has one'),
	name: z.string().nullable().describe('The tag or filter concerned, when there is one'),
});
export type GuildCommandTemplateIssue = z.infer<typeof GuildCommandTemplateIssueSchema>;

export const GuildCommandCreateRequestSchema = z.object({
	name: GuildCommandNameSchema,
	description: z.string().max(MAX_GUILD_COMMAND_DESCRIPTION_LENGTH).nullish().describe('Shown in autocomplete'),
	template: GuildCommandTemplateSchema,
	input_mode: GuildCommandInputMode,
	input_type: GuildCommandInputType.default('text'),
	counters: z.array(GuildCommandCounterInputSchema).max(MAX_GUILD_COMMAND_COUNTERS).optional(),
	input_hint: z
		.string()
		.max(MAX_GUILD_COMMAND_HINT_LENGTH)
		.nullish()
		.describe('Placeholder shown in the input while the command is filled in'),
});
export type GuildCommandCreateRequest = z.infer<typeof GuildCommandCreateRequestSchema>;

export const GuildCommandUpdateRequestSchema = z.object({
	name: GuildCommandNameSchema.optional(),
	description: z.string().max(MAX_GUILD_COMMAND_DESCRIPTION_LENGTH).nullish(),
	template: GuildCommandTemplateSchema.optional(),
	input_mode: GuildCommandInputMode.optional(),
	input_type: GuildCommandInputType.optional(),
	counters: z.array(GuildCommandCounterInputSchema).max(MAX_GUILD_COMMAND_COUNTERS).optional(),
	input_hint: z.string().max(MAX_GUILD_COMMAND_HINT_LENGTH).nullish(),
});
export type GuildCommandUpdateRequest = z.infer<typeof GuildCommandUpdateRequestSchema>;

const GuildCommandInputSchema = z
	.string()
	.max(MAX_GUILD_COMMAND_INPUT_LENGTH)
	.regex(/^[^\r\n]*$/)
	.nullish()
	.describe('What the member typed, as wire text (mentions as <@...>); one line');

export const GuildCommandRunRequestSchema = z.object({
	input: GuildCommandInputSchema,
	persona_id: SnowflakeStringType.nullish().describe("One of the caller's personas to post as"),
	nonce: MessageNonceRequest,
});
export type GuildCommandRunRequest = z.infer<typeof GuildCommandRunRequestSchema>;

export const GuildCommandPreviewRequestSchema = z.object({
	template: GuildCommandTemplateSchema,
	input: GuildCommandInputSchema,
	channel_id: SnowflakeType.nullish().describe('A channel of this community to fill in as the channel'),
	counters: z
		.array(GuildCommandCounterInputSchema)
		.max(MAX_GUILD_COMMAND_COUNTERS)
		.optional()
		.describe('The counters being edited, each filled in as a run would read it'),
	run: z
		.number()
		.int()
		.min(1)
		.max(1_000_000)
		.optional()
		.describe('What the counters read: which run this preview stands for, from 1'),
});
export type GuildCommandPreviewRequest = z.infer<typeof GuildCommandPreviewRequestSchema>;

export const GuildCommandPreviewResponseSchema = z.object({
	content: z.string().nullable().describe('The filled-in message; null when the template has a problem'),
	issue: GuildCommandTemplateIssueSchema.nullable().describe('What stopped the template; null when it worked'),
});
export type GuildCommandPreviewResponse = z.infer<typeof GuildCommandPreviewResponseSchema>;

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
	counters: z
		.array(GuildCommandCounterSchema)
		.optional()
		.describe("The counters; only returned to those who may edit the community's commands"),
});
export type GuildCommandResponse = z.infer<typeof GuildCommandResponseSchema>;

export const GuildCommandListResponseSchema = z.array(GuildCommandResponseSchema);

export const GuildCommandCountSchema = z.object({
	counter_id: SnowflakeStringType.describe('The counter'),
	scope_key: z.string().describe('Who or what this count is for'),
	value: z.number().int().describe('The count'),
});
export type GuildCommandCount = z.infer<typeof GuildCommandCountSchema>;

export const GuildCommandCountListResponseSchema = z.array(GuildCommandCountSchema);

export const GuildCommandCountSetRequestSchema = z.object({
	counter_id: SnowflakeStringType.describe('The counter'),
	scope_key: z.string().max(200).describe('The count to change, as listed'),
	value: z.number().int().min(0).max(1_000_000_000).describe('The new count'),
});
export type GuildCommandCountSetRequest = z.infer<typeof GuildCommandCountSetRequestSchema>;

export const GuildCommandCounterParam = z.object({
	guild_id: SnowflakeType.describe('The ID of the guild'),
	command_id: SnowflakeType.describe('The ID of the command'),
	counter_id: SnowflakeType.describe('The ID of the counter'),
});

export const GuildCommandParam = z.object({
	guild_id: SnowflakeType.describe('The ID of the guild'),
	command_id: SnowflakeType.describe('The ID of the command'),
});

export const ChannelGuildCommandParam = z.object({
	channel_id: SnowflakeType.describe('The ID of the channel'),
	command_id: SnowflakeType.describe('The ID of the command'),
});
