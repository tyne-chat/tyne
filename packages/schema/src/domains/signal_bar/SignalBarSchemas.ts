// SPDX-License-Identifier: AGPL-3.0-or-later

import {MessageSubprofileResponseSchema} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {SnowflakeStringType, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {schemaMetadata} from '@fluxer/schema/src/SchemaMetadata';
import {z} from 'zod';

export const MAX_SIGNAL_BAR_SIGNALS = 12;
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
export type ChannelSignalToggleRequest = z.infer<typeof ChannelSignalToggleRequestSchema>;

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
export type ChannelSignalBarEnabledRequest = z.infer<typeof ChannelSignalBarEnabledRequestSchema>;

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
