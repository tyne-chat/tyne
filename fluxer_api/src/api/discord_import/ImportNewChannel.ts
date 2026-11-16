// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: a Discord channel imported into a new channel in the archive community (tyne-chat/tyne#608).
// The importer creates it, and its category when the community has no category of that name yet, as the
// API's channel creation does (ChannelOperationsService.createChannel): the same rows, the same
// positions, the category's permission overwrites, the name rule of a community without flexible names,
// and a CHANNEL_CREATE to the community, without which the gateway (which keeps the channel list in
// memory) would not list it. The ids are the plan's, so a later import fills the same channel. No audit
// log entry: an import is not a member's action.
import type {ChannelID, GuildID} from '@app/api/BrandedTypes';
import {mapChannelToResponse} from '@app/api/channel/ChannelMappers';
import type {ChannelRepository} from '@app/api/channel/ChannelRepository';
import {withThreadParentFields} from '@app/api/channel/services/thread/ThreadParentSettings';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import {ChannelHelpers} from '@app/api/guild/services/channel/ChannelHelpers';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {UserCacheService} from '@app/api/infrastructure/UserCacheService';
import {createRequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import type {Channel} from '@app/api/models/Channel';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {ContentWarningLevel, GuildFeatures} from '@fluxer/constants/src/GuildConstants';
import {ChannelNameType} from '@fluxer/schema/src/primitives/ChannelValidators';

/** A new channel in the plan: what to create, in which community and category. */
export interface PlanNewChannel {
	guild_id: string;
	channel_id: string;
	name: string;
	topic: string | null;
	/** Found by name when the community has one already, else created with this id. */
	category: {channel_id: string; name: string} | null;
}

export interface NewChannelDeps {
	channelRepository: Pick<ChannelRepository, 'channelData' | 'threads'>;
	guildRepository: Pick<GuildRepository, 'findUnique'>;
	gatewayService: Pick<IGatewayService, 'dispatchGuild'>;
	userCacheService: UserCacheService;
}

export interface NewChannelResult {
	channel: Channel | null;
	createdCategory: string | null;
	categoryId: string | null;
	name: string;
}

/** Creates the plan's new channel (and its category) unless it exists; in a dry run, only says what it would. */
export async function createNewChannel(
	plan: PlanNewChannel,
	deps: NewChannelDeps,
	dryRun: boolean,
): Promise<NewChannelResult> {
	const guildId = BigInt(plan.guild_id) as GuildID;
	const guild = await deps.guildRepository.findUnique(guildId);
	if (!guild) throw new Error(`the community ${plan.guild_id} for the new channel does not exist`);
	const flexibleNames = guild.features.has(GuildFeatures.TEXT_CHANNEL_FLEXIBLE_NAMES);
	const name = flexibleNames ? plan.name : ChannelNameType.parse(plan.name);
	const channels = await deps.channelRepository.channelData.listGuildChannels(guildId, 'enrolled');
	let category: Channel | null = null;
	let createdCategory: string | null = null;
	if (plan.category) {
		const wanted = plan.category;
		category =
			channels.find((c) => c.id.toString() === wanted.channel_id && c.type === ChannelTypes.GUILD_CATEGORY) ??
			channels.find((c) => c.type === ChannelTypes.GUILD_CATEGORY && c.name === wanted.name) ??
			null;
		if (!category) {
			createdCategory = wanted.channel_id;
			if (!dryRun) {
				category = await createRow(deps, {
					channelId: BigInt(wanted.channel_id) as ChannelID,
					guildId,
					type: ChannelTypes.GUILD_CATEGORY,
					name: wanted.name,
					topic: null,
					parent: null,
					position: ChannelHelpers.getNextGlobalChannelPosition(ChannelTypes.GUILD_CATEGORY, null, channels),
				});
				channels.push(category);
			}
		}
	}
	const categoryId = category?.id.toString() ?? createdCategory;
	if (dryRun) return {channel: null, createdCategory, categoryId, name};
	const channel = await createRow(deps, {
		channelId: BigInt(plan.channel_id) as ChannelID,
		guildId,
		type: ChannelTypes.GUILD_TEXT,
		name,
		topic: plan.topic,
		parent: category,
		position: ChannelHelpers.getNextGlobalChannelPosition(ChannelTypes.GUILD_TEXT, category?.id ?? null, channels),
	});
	return {channel, createdCategory, categoryId, name};
}

async function createRow(
	deps: NewChannelDeps,
	row: {
		channelId: ChannelID;
		guildId: GuildID;
		type: number;
		name: string;
		topic: string | null;
		parent: Channel | null;
		position: number;
	},
): Promise<Channel> {
	const channel = await deps.channelRepository.channelData.create({
		channel_id: row.channelId,
		guild_id: row.guildId,
		type: row.type,
		name: row.name,
		topic: row.topic,
		icon_hash: null,
		url: null,
		parent_id: row.parent?.id ?? null,
		position: row.position,
		owner_id: null,
		recipient_ids: null,
		nsfw: null,
		content_warning_level: ContentWarningLevel.INHERIT,
		content_warning_text: null,
		rate_limit_per_user: 0,
		bitrate: null,
		user_limit: null,
		voice_connection_limit: null,
		rtc_region: null,
		rtc_p2p: null,
		last_message_id: null,
		last_pin_timestamp: null,
		// A channel created in a category starts with the category's overwrites, as the API's does.
		permission_overwrites: row.parent?.permissionOverwrites
			? new Map(
					Array.from(row.parent.permissionOverwrites.entries()).map(([targetId, overwrite]) => [
						targetId,
						overwrite.toPermissionOverwrite(),
					]),
				)
			: null,
		nicks: null,
		soft_deleted: false,
		indexed_at: null,
		version: 1,
	});
	await deps.gatewayService.dispatchGuild({
		guildId: row.guildId,
		event: 'CHANNEL_CREATE',
		data: await withThreadParentFields(
			deps.channelRepository.threads,
			channel,
			await mapChannelToResponse({
				channel,
				currentUserId: null,
				userCacheService: deps.userCacheService,
				requestCache: createRequestCache(),
			}),
		),
	});
	return channel;
}
