// SPDX-License-Identifier: AGPL-3.0-or-later

import {MessageSubprofileResponseSchema} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {SnowflakeStringType, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {schemaMetadata} from '@fluxer/schema/src/SchemaMetadata';
import {z} from 'zod';

export const MAX_SIGNAL_BAR_SIGNALS = 50;
export const MAX_SIGNAL_LABEL_LENGTH = 32;

const SignalIdSchema = z
	.string()
	.regex(/^[a-z0-9]{1,32}$/)
	.describe('The unique identifier of the signal within the bar');

export const SignalBarSignalSchema = z.object({
	id: SignalIdSchema,
	emoji_id: SnowflakeStringType.nullable().describe('Custom emoji ID (null for Unicode)'),
	emoji_name: z.string().min(1).max(64).describe('Emoji name or Unicode character'),
	animated: z.boolean().describe('Whether the emoji is animated'),
	label: z.string().max(MAX_SIGNAL_LABEL_LENGTH).nullable().describe('Optional label shown instead of the emoji name'),
	everywhere: z
		.boolean()
		.default(false)
		.describe('Whether a user may set this signal in every chat where they have one on at once'),
});
export type SignalBarSignal = z.infer<typeof SignalBarSignalSchema>;

export const SignalBarConfigSchema = z.object({
	version: z.number().int().min(0).describe('Incremented on every change to the bar'),
	signals: z.array(SignalBarSignalSchema).max(MAX_SIGNAL_BAR_SIGNALS),
});
export type SignalBarConfig = z.infer<typeof SignalBarConfigSchema>;

export const SignalBarResponseSchema = SignalBarConfigSchema.extend({
	guild_id: SnowflakeStringType.nullable().describe('The home community that owns the bar'),
	can_manage: z.boolean().describe('Whether the requesting user may edit the bar'),
});
export type SignalBarResponse = z.infer<typeof SignalBarResponseSchema>;

export const SignalBarUpdateRequestSchema = z.object({
	signals: z
		.array(
			z.object({
				id: SignalIdSchema.nullish().describe('Existing signal ID; omit to add a new signal'),
				emoji_id: SnowflakeStringType.nullish().describe('Custom emoji ID (null for Unicode)'),
				emoji_name: z.string().min(1).max(64).describe('Emoji name or Unicode character'),
				label: z.string().trim().max(MAX_SIGNAL_LABEL_LENGTH).nullish(),
				everywhere: z
					.boolean()
					.nullish()
					.describe('Whether the signal may be set everywhere at once; omit to keep the current setting'),
			}),
		)
		.max(MAX_SIGNAL_BAR_SIGNALS),
});
export type SignalBarUpdateRequest = z.infer<typeof SignalBarUpdateRequestSchema>;

export const ChannelSignalEntrySchema = z.object({
	signal_id: SignalIdSchema,
	user: UserPartialResponse,
	persona_id: SnowflakeStringType.nullable().describe('The persona the account is currently signalling as, if any'),
	subprofile: MessageSubprofileResponseSchema.nullable(),
	activated_at: z.number().int().describe('Unix timestamp in milliseconds'),
});
export type ChannelSignalEntry = z.infer<typeof ChannelSignalEntrySchema>;

export const ChannelSignalsResponseSchema = z.object({
	enabled: z.boolean().describe('Whether the signal bar is switched on in this channel'),
	bar_version: z.number().int(),
	entries: z.array(ChannelSignalEntrySchema),
});
export type ChannelSignalsResponse = z.infer<typeof ChannelSignalsResponseSchema>;

export const ChannelSignalToggleRequestSchema = z
	.object({
		persona_id: SnowflakeStringType.nullish().describe('Persona the account is currently signalling as'),
	})
	.optional();

export const ChannelSignalParam = z.object({
	channel_id: SnowflakeType.describe('The ID of the channel'),
	signal_id: SignalIdSchema,
});

export const ChannelSignalUpdateEventSchema = z.object({
	channel_id: SnowflakeStringType,
	bar_version: z.number().int(),
	added: z.array(ChannelSignalEntrySchema),
	removed: z.array(
		z.object({
			signal_id: SignalIdSchema,
			user_id: SnowflakeStringType,
		}),
	),
});
export type ChannelSignalUpdateEvent = z.infer<typeof ChannelSignalUpdateEventSchema>;

export const SignalBarUpdateEventSchema = z.object({
	version: z.number().int(),
});
export type SignalBarUpdateEvent = z.infer<typeof SignalBarUpdateEventSchema>;

const SignalBarFlagMapSchema = z
	.record(z.string().max(20), z.boolean())
	.register(schemaMetadata, {preserveEmptyValues: true});

export const GuildSignalBarSettingsSchema = z.object({
	default: z.boolean().describe('Whether channels without a category or channel setting show the signal bar'),
	categories: SignalBarFlagMapSchema,
	channels: SignalBarFlagMapSchema,
});
export type GuildSignalBarSettings = z.infer<typeof GuildSignalBarSettingsSchema>;

export const EMPTY_GUILD_SIGNAL_BAR_SETTINGS: GuildSignalBarSettings = {default: false, categories: {}, channels: {}};

export function resolveSignalBarEnabled(
	settings: GuildSignalBarSettings,
	channelId: string,
	categoryId: string | null,
): boolean {
	const channel = settings.channels[channelId];
	if (channel !== undefined) return channel;
	const category = categoryId === null ? undefined : settings.categories[categoryId];
	if (category !== undefined) return category;
	return settings.default;
}

export const ChannelSignalBarEnabledRequestSchema = z.object({
	enabled: z.boolean(),
});

export const ChannelSignalUserParam = z.object({
	channel_id: SnowflakeType.describe('The ID of the channel'),
	signal_id: SignalIdSchema,
	user_id: SnowflakeType.describe('The ID of the user whose signal is turned off'),
});

export const ChannelSignalBarUpdateEventSchema = z.object({
	channel_id: SnowflakeStringType,
	enabled: z.boolean(),
});
export type ChannelSignalBarUpdateEvent = z.infer<typeof ChannelSignalBarUpdateEventSchema>;

export const MAX_USER_SIGNAL_CHATS = 200;

export const UserSignalRefSchema = z.object({
	signal_id: SignalIdSchema,
	persona_id: SnowflakeStringType.nullable().describe('The persona the signal is shown as, or null for the account'),
});
export type UserSignalRef = z.infer<typeof UserSignalRefSchema>;

export const UserSignalChatSchema = z.object({
	channel_id: SnowflakeStringType,
	signals: z.array(UserSignalRefSchema).describe("The user's lit signals in this chat, oldest first"),
	updated_at: z.number().int().describe('When the newest of these signals was lit, in Unix milliseconds'),
});
export type UserSignalChat = z.infer<typeof UserSignalChatSchema>;

export const UserSignalsResponseSchema = z.object({
	chats: z.array(UserSignalChatSchema).describe('Every chat where the user has a signal on, newest first'),
	restore_available: z.boolean().describe('Whether the last change everywhere can be restored'),
});
export type UserSignalsResponse = z.infer<typeof UserSignalsResponseSchema>;

export const UserSignalsUpdateRequestSchema = z.object({
	signal_id: SignalIdSchema.nullable().describe(
		'The signal to set in every chat where the user has one on, turning their others there off; null turns every signal of theirs off',
	),
	channel_id: SnowflakeStringType.nullish().describe(
		'The open chat, included even if no signal of the user is on there',
	),
	persona_id: SnowflakeStringType.nullish().describe("The persona the open chat's signal is shown as"),
});
export type UserSignalsUpdateRequest = z.infer<typeof UserSignalsUpdateRequestSchema>;

export const UserSignalsRestoreActionSchema = z.object({
	kind: z
		.enum(['set', 'off', 'restore'])
		.describe('What the last change everywhere was: a signal set everywhere, every signal off, or a restore'),
	signal_id: SignalIdSchema.nullable().describe('The signal set everywhere, for kind set'),
});
export type UserSignalsRestoreAction = z.infer<typeof UserSignalsRestoreActionSchema>;

export const UserSignalsSnapshotSchema = z.object({
	created_at: z.number().int(),
	action: UserSignalsRestoreActionSchema,
	chats: z
		.array(z.object({channel_id: SnowflakeStringType, signals: z.array(UserSignalRefSchema)}))
		.max(MAX_USER_SIGNAL_CHATS),
});
export type UserSignalsSnapshot = z.infer<typeof UserSignalsSnapshotSchema>;

export const UserSignalsRestoreResponseSchema = z.object({
	available: z.boolean().describe('Whether there is anything to restore'),
	created_at: z.number().int().nullable().describe('When the change Restore undoes was made, in Unix milliseconds'),
	action: UserSignalsRestoreActionSchema.nullable(),
	chats: z.array(
		z.object({
			channel_id: SnowflakeStringType,
			available: z
				.boolean()
				.describe('False when the user can no longer light signals in this chat; Restore leaves it out'),
			now: z.array(UserSignalRefSchema).describe("The user's signals there now"),
			after: z.array(UserSignalRefSchema).describe('The signals Restore puts back'),
		}),
	),
});
export type UserSignalsRestoreResponse = z.infer<typeof UserSignalsRestoreResponseSchema>;
