// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID} from '@app/api/BrandedTypes';
import {fetchOne, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {defineTable} from '@app/api/database/CassandraTableDsl';
import {
	EMPTY_GUILD_SIGNAL_BAR_SETTINGS,
	type GuildSignalBarSettings,
	GuildSignalBarSettingsSchema,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';

interface GuildSignalBarSettingsRow {
	guild_id: GuildID;
	settings: string;
	updated_at: Date;
}

interface DmSignalBarSettingsRow {
	channel_id: ChannelID;
	enabled: boolean;
	updated_at: Date;
}

const GuildSignalBarSettingsTable = defineTable<GuildSignalBarSettingsRow, 'guild_id'>({
	name: 'guild_signal_bar_settings',
	columns: ['guild_id', 'settings', 'updated_at'] as const,
	primaryKey: ['guild_id'],
});

const DmSignalBarSettingsTable = defineTable<DmSignalBarSettingsRow, 'channel_id'>({
	name: 'dm_signal_bar_settings',
	columns: ['channel_id', 'enabled', 'updated_at'] as const,
	primaryKey: ['channel_id'],
});

const FETCH_GUILD_CQL = GuildSignalBarSettingsTable.selectCql({
	where: [GuildSignalBarSettingsTable.where.eq('guild_id')],
	limit: 1,
});

const FETCH_DM_CQL = DmSignalBarSettingsTable.selectCql({
	where: [DmSignalBarSettingsTable.where.eq('channel_id')],
	limit: 1,
});

export class SignalBarSettingsRepository {
	async getGuildSettings(guildId: GuildID): Promise<GuildSignalBarSettings> {
		const row = await fetchOne<GuildSignalBarSettingsRow>(FETCH_GUILD_CQL, {guild_id: guildId});
		if (!row) return EMPTY_GUILD_SIGNAL_BAR_SETTINGS;
		try {
			const parsed = GuildSignalBarSettingsSchema.safeParse(JSON.parse(row.settings));
			return parsed.success ? parsed.data : EMPTY_GUILD_SIGNAL_BAR_SETTINGS;
		} catch {
			return EMPTY_GUILD_SIGNAL_BAR_SETTINGS;
		}
	}

	async setGuildSettings(guildId: GuildID, settings: GuildSignalBarSettings): Promise<void> {
		await upsertOne(
			GuildSignalBarSettingsTable.upsertAll({
				guild_id: guildId,
				settings: JSON.stringify(settings),
				updated_at: new Date(),
			}),
		);
	}

	async isDmEnabled(channelId: ChannelID): Promise<boolean> {
		const row = await fetchOne<DmSignalBarSettingsRow>(FETCH_DM_CQL, {channel_id: channelId});
		return row?.enabled ?? false;
	}

	async setDmEnabled(channelId: ChannelID, enabled: boolean): Promise<void> {
		await upsertOne(DmSignalBarSettingsTable.upsertAll({channel_id: channelId, enabled, updated_at: new Date()}));
	}
}
