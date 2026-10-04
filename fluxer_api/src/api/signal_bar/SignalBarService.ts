// SPDX-License-Identifier: AGPL-3.0-or-later

import {randomBytes} from 'node:crypto';
import {
	type ChannelID,
	createChannelID,
	createEmojiID,
	createGuildID,
	createPersonaID,
	createUserID,
	type GuildID,
	type UserID,
} from '@app/api/BrandedTypes';
import type {AuthenticatedChannel} from '@app/api/channel/services/AuthenticatedChannel';
import {dispatchChannelEvent} from '@app/api/channel/services/ChannelGatewayDispatch';
import type {IGuildRepositoryAggregate} from '@app/api/guild/repositories/IGuildRepositoryAggregate';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {InstanceConfigRepository} from '@app/api/instance/InstanceConfigRepository';
import {Logger} from '@app/api/Logger';
import type {Channel} from '@app/api/models/Channel';
import type {User} from '@app/api/models/User';
import {PersonaNotFoundError} from '@app/api/persona/errors/PersonaErrors';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';
import type {SignalBarSettingsRepository} from '@app/api/signal_bar/SignalBarSettingsRepository';
import {UnknownSignalError} from '@app/api/signal_bar/UnknownSignalError';
import {mapUserToPartialResponse} from '@app/api/user/UserMappers';
import {assertGuildMemberCanCommunicate} from '@app/api/utils/GuildCommunicationUtils';
import {ChannelTypes, Permissions, TEXT_BASED_CHANNEL_TYPES} from '@fluxer/constants/src/ChannelConstants';
import {CannotSendMessageToNonTextChannelError} from '@fluxer/errors/src/domains/channel/CannotSendMessageToNonTextChannelError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import {
	type ChannelSignalEntry,
	ChannelSignalEntrySchema,
	type ChannelSignalsResponse,
	type ChannelSignalUpdateEvent,
	type GuildSignalBarSettings,
	resolveSignalBarEnabled,
	type SignalBarConfig,
	SignalBarConfigSchema,
	type SignalBarResponse,
	type SignalBarSignal,
	type SignalBarUpdateRequest,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import type {ICacheService} from '@pkgs/cache/src/ICacheService';

const SIGNAL_BAR_CONFIG_KEY = 'signal_bar';
const EMPTY_CONFIG: SignalBarConfig = {version: 0, signals: []};
const ENTRY_TTL_SECONDS = 600;
const INDEX_TTL_SECONDS = 7 * 24 * 60 * 60;
const OFFLINE_MISS_TTL_SECONDS = 300;
const OFFLINE_MISSES_BEFORE_CLEAR = 2;
const NO_PERSONA = '0';
const ACTIVE_USERS_KEY = 'signalbar:users';
const UNICODE_EMOJI_REGEX = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣/u;
const GUILD_DISPATCH_PAGE_SIZE = 100;

const entryKey = (channelId: string, signalId: string, userId: string) =>
	`signalbar:entry:${channelId}:${signalId}:${userId}`;
const channelIndexKey = (channelId: string) => `signalbar:channel:${channelId}`;
const userIndexKey = (userId: string) => `signalbar:user:${userId}`;
const offlineMissKey = (userId: string) => `signalbar:offline:${userId}`;

interface StoredEntry extends ChannelSignalEntry {
	channel_id: string;
}

interface SignalBarServiceDeps {
	instanceConfigRepository: InstanceConfigRepository;
	cacheService: ICacheService;
	gatewayService: IGatewayService;
	guildRepository: IGuildRepositoryAggregate;
	personaRepository: IPersonaRepository;
	settingsRepository: SignalBarSettingsRepository;
	findUser: (userId: UserID) => Promise<User | null>;
	findChannel: (channelId: ChannelID) => Promise<Channel | null>;
	listGuildChannels: (guildId: GuildID) => Promise<Array<Channel>>;
}

function parseStoredConfig(raw: string | null): SignalBarConfig {
	if (!raw) return EMPTY_CONFIG;
	try {
		const parsed = SignalBarConfigSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : EMPTY_CONFIG;
	} catch {
		return EMPTY_CONFIG;
	}
}

function toEntry(stored: StoredEntry): ChannelSignalEntry {
	const {channel_id: _channelId, ...entry} = stored;
	return entry;
}

export class SignalBarService {
	constructor(private readonly deps: SignalBarServiceDeps) {}

	private async getHomeGuildId(): Promise<GuildID | null> {
		const policy = await this.deps.instanceConfigRepository.getInstancePolicyConfig();
		return policy.signal_bar_guild_id ? createGuildID(BigInt(policy.signal_bar_guild_id)) : null;
	}

	async getConfig(): Promise<SignalBarConfig> {
		const [homeGuildId, raw] = await Promise.all([
			this.getHomeGuildId(),
			this.deps.instanceConfigRepository.getConfig(SIGNAL_BAR_CONFIG_KEY),
		]);
		const stored = parseStoredConfig(raw);
		return homeGuildId ? stored : {version: stored.version, signals: []};
	}

	async canManage(userId: UserID): Promise<boolean> {
		const homeGuildId = await this.getHomeGuildId();
		if (!homeGuildId) return false;
		try {
			return await this.deps.gatewayService.checkPermission({
				guildId: homeGuildId,
				userId,
				permission: Permissions.MANAGE_GUILD,
			});
		} catch {
			return false;
		}
	}

	async getBar(userId: UserID): Promise<SignalBarResponse> {
		const [homeGuildId, config, canManage] = await Promise.all([
			this.getHomeGuildId(),
			this.getConfig(),
			this.canManage(userId),
		]);
		return {...config, guild_id: homeGuildId ? homeGuildId.toString() : null, can_manage: canManage};
	}

	async updateBar(userId: UserID, request: SignalBarUpdateRequest): Promise<SignalBarResponse> {
		if (!(await this.canManage(userId))) throw new MissingPermissionsError();
		const current = await this.getConfig();
		const currentIds = new Set(current.signals.map((signal) => signal.id));
		const usedIds = new Set<string>();
		const signals: Array<SignalBarSignal> = [];
		for (const item of request.signals) {
			let emojiId: string | null = null;
			let emojiName = item.emoji_name;
			let animated = false;
			if (item.emoji_id) {
				const emoji = await this.deps.guildRepository.getEmojiById(createEmojiID(BigInt(item.emoji_id)));
				if (!emoji) throw new UnknownSignalError();
				emojiId = emoji.id.toString();
				emojiName = emoji.name;
				animated = emoji.isAnimated;
			} else if (!UNICODE_EMOJI_REGEX.test(emojiName)) {
				throw new UnknownSignalError();
			}
			const id = item.id && currentIds.has(item.id) && !usedIds.has(item.id) ? item.id : randomBytes(6).toString('hex');
			usedIds.add(id);
			signals.push({id, emoji_id: emojiId, emoji_name: emojiName, animated, label: item.label || null});
		}
		await this.writeConfig({version: current.version + 1, signals});
		return this.getBar(userId);
	}

	private async writeConfig(config: SignalBarConfig): Promise<void> {
		await this.deps.instanceConfigRepository.setConfig(SIGNAL_BAR_CONFIG_KEY, JSON.stringify(config));
		await this.dispatchBarUpdate(config.version);
	}

	private async dispatchBarUpdate(version: number): Promise<void> {
		let lastGuildId: GuildID | undefined;
		for (;;) {
			const guilds = await this.deps.guildRepository.listAllGuildsPaginated(GUILD_DISPATCH_PAGE_SIZE, lastGuildId);
			await Promise.all(
				guilds.map((guild) =>
					this.deps.gatewayService
						.dispatchGuild({guildId: guild.id, event: 'SIGNAL_BAR_UPDATE', data: {version}})
						.catch((error) => Logger.warn({err: error, guildId: guild.id}, 'Failed to dispatch signal bar update')),
				),
			);
			if (guilds.length < GUILD_DISPATCH_PAGE_SIZE) return;
			lastGuildId = guilds[guilds.length - 1]!.id;
		}
	}

	private ensureTextChannel(channel: Channel): void {
		if (!TEXT_BASED_CHANNEL_TYPES.has(channel.type)) throw new CannotSendMessageToNonTextChannelError();
	}

	private async readChannelEntries(channelId: string): Promise<Array<StoredEntry>> {
		const members = Array.from(await this.deps.cacheService.smembers(channelIndexKey(channelId)));
		if (members.length === 0) return [];
		const values = await this.deps.cacheService.mget<unknown>(
			members.map((member) => `signalbar:entry:${channelId}:${member}`),
		);
		const entries: Array<StoredEntry> = [];
		await Promise.all(
			members.map(async (member, index) => {
				const parsed = ChannelSignalEntrySchema.safeParse(values[index]);
				if (parsed.success) {
					entries.push({...parsed.data, channel_id: channelId});
				} else {
					await this.deps.cacheService.srem(channelIndexKey(channelId), member);
				}
			}),
		);
		return entries.sort((a, b) => a.activated_at - b.activated_at);
	}

	/** Whether the bar is switched on for a channel. Off unless a manager turned it on. */
	async isChannelEnabled(channel: Channel): Promise<boolean> {
		if (!channel.guildId) return this.deps.settingsRepository.isDmEnabled(channel.id);
		const settings = await this.deps.settingsRepository.getGuildSettings(channel.guildId);
		return resolveSignalBarEnabled(settings, channel.id.toString(), channel.parentId?.toString() ?? null);
	}

	async getChannelSignals(authChannel: AuthenticatedChannel): Promise<ChannelSignalsResponse> {
		this.ensureTextChannel(authChannel.channel);
		const config = await this.getConfig();
		if (!(await this.isChannelEnabled(authChannel.channel))) {
			return {enabled: false, bar_version: config.version, entries: []};
		}
		const signalIds = new Set(config.signals.map((signal) => signal.id));
		const entries = await this.readChannelEntries(authChannel.channel.id.toString());
		return {
			enabled: true,
			bar_version: config.version,
			entries: entries.filter((entry) => signalIds.has(entry.signal_id)).map(toEntry),
		};
	}

	/** Managers are community managers, either person in a 1:1 DM, or a group DM's owner. */
	private async assertCanManageChannel(authChannel: AuthenticatedChannel, userId: UserID): Promise<void> {
		const {channel} = authChannel;
		if (channel.guildId) {
			await authChannel.checkPermission(Permissions.MANAGE_GUILD);
		} else if (channel.type === ChannelTypes.GROUP_DM && channel.ownerId !== userId) {
			throw new MissingPermissionsError();
		}
	}

	private async assertCanManageGuild(guildId: GuildID, userId: UserID): Promise<void> {
		const allowed = await this.deps.gatewayService
			.checkPermission({guildId, userId, permission: Permissions.MANAGE_GUILD})
			.catch(() => false);
		if (!allowed) throw new MissingPermissionsError();
	}

	async getGuildSettings(guildId: GuildID, userId: UserID): Promise<GuildSignalBarSettings> {
		await this.assertCanManageGuild(guildId, userId);
		return this.deps.settingsRepository.getGuildSettings(guildId);
	}

	async updateGuildSettings(
		guildId: GuildID,
		userId: UserID,
		requested: GuildSignalBarSettings,
	): Promise<GuildSignalBarSettings> {
		await this.assertCanManageGuild(guildId, userId);
		const channels = await this.deps.listGuildChannels(guildId);
		const categoryIds = new Set<string>();
		const textChannels: Array<Channel> = [];
		for (const channel of channels) {
			if (channel.type === ChannelTypes.GUILD_CATEGORY) categoryIds.add(channel.id.toString());
			else if (channel.type === ChannelTypes.GUILD_TEXT || channel.type === ChannelTypes.GUILD_ANNOUNCEMENT) {
				textChannels.push(channel);
			}
		}
		const textChannelIds = new Set(textChannels.map((channel) => channel.id.toString()));
		const next: GuildSignalBarSettings = {
			default: requested.default,
			categories: Object.fromEntries(Object.entries(requested.categories).filter(([id]) => categoryIds.has(id))),
			channels: Object.fromEntries(Object.entries(requested.channels).filter(([id]) => textChannelIds.has(id))),
		};
		const previous = await this.deps.settingsRepository.getGuildSettings(guildId);
		await this.deps.settingsRepository.setGuildSettings(guildId, next);
		for (const channel of textChannels) {
			const channelId = channel.id.toString();
			const categoryId = channel.parentId?.toString() ?? null;
			const enabled = resolveSignalBarEnabled(next, channelId, categoryId);
			if (enabled !== resolveSignalBarEnabled(previous, channelId, categoryId)) {
				await this.announceEnabled(channel, enabled);
			}
		}
		return next;
	}

	async setDmEnabled(authChannel: AuthenticatedChannel, userId: UserID, enabled: boolean): Promise<void> {
		const {channel} = authChannel;
		this.ensureTextChannel(channel);
		if (channel.guildId) throw new MissingPermissionsError();
		await this.assertCanManageChannel(authChannel, userId);
		if ((await this.deps.settingsRepository.isDmEnabled(channel.id)) === enabled) return;
		await this.deps.settingsRepository.setDmEnabled(channel.id, enabled);
		await this.announceEnabled(channel, enabled);
	}

	/** Tells the channel its bar was switched on or off; switching off clears lit signals. */
	private async announceEnabled(channel: Channel, enabled: boolean): Promise<void> {
		const channelId = channel.id.toString();
		if (!enabled) {
			const entries = await this.readChannelEntries(channelId);
			await this.removeEntries(entries.map((entry) => ({channelId, signalId: entry.signal_id, userId: entry.user.id})));
		}
		await dispatchChannelEvent({
			gatewayService: this.deps.gatewayService,
			channel,
			event: 'CHANNEL_SIGNAL_BAR_UPDATE',
			data: {channel_id: channelId, enabled},
		});
	}

	/** A manager turns one account's signal off. */
	async removeUserSignal({
		authChannel,
		userId,
		signalId,
		targetUserId,
	}: {
		authChannel: AuthenticatedChannel;
		userId: UserID;
		signalId: string;
		targetUserId: UserID;
	}): Promise<void> {
		await this.assertCanManageChannel(authChannel, userId);
		const {channel} = authChannel;
		const removed = await this.removeEntries([
			{channelId: channel.id.toString(), signalId, userId: targetUserId.toString()},
		]);
		if (removed.length > 0) {
			const config = await this.getConfig();
			await this.dispatchChannelUpdate(channel, config.version, [], removed);
		}
	}

	async activate({
		authChannel,
		userId,
		signalId,
		personaId,
	}: {
		authChannel: AuthenticatedChannel;
		userId: UserID;
		signalId: string;
		personaId?: string | null;
	}): Promise<void> {
		const {channel} = authChannel;
		this.ensureTextChannel(channel);
		assertGuildMemberCanCommunicate(authChannel.member);
		if (channel.guildId) await authChannel.checkPermission(Permissions.SEND_MESSAGES);
		const config = await this.getConfig();
		if (!config.signals.some((signal) => signal.id === signalId)) throw new UnknownSignalError();
		if (!(await this.isChannelEnabled(channel))) throw new MissingPermissionsError();
		const user = await this.deps.findUser(userId);
		if (!user) throw new MissingPermissionsError();
		let subprofile: ChannelSignalEntry['subprofile'] = null;
		let entryPersonaId: string | null = null;
		if (personaId && personaId !== NO_PERSONA) {
			const persona = await this.deps.personaRepository.findById(userId, createPersonaID(BigInt(personaId)));
			if (!persona || persona.isDeleted) throw new PersonaNotFoundError();
			subprofile = persona.toSubprofileResponse(await this.deps.personaRepository.findSettings(userId));
			entryPersonaId = persona.id.toString();
		}
		const channelId = channel.id.toString();
		const userKey = userId.toString();
		const key = entryKey(channelId, signalId, userKey);
		const existing = ChannelSignalEntrySchema.safeParse(await this.deps.cacheService.get<unknown>(key));
		if (existing.success && existing.data.persona_id === entryPersonaId) {
			await this.deps.cacheService.expire(key, ENTRY_TTL_SECONDS);
			return;
		}
		const entry: StoredEntry = {
			channel_id: channelId,
			signal_id: signalId,
			user: mapUserToPartialResponse(user),
			persona_id: entryPersonaId,
			subprofile,
			activated_at: existing.success ? existing.data.activated_at : Date.now(),
		};
		await this.deps.cacheService.set(key, entry, ENTRY_TTL_SECONDS);
		await Promise.all([
			this.deps.cacheService.sadd(channelIndexKey(channelId), `${signalId}:${userKey}`, INDEX_TTL_SECONDS),
			this.deps.cacheService.sadd(userIndexKey(userKey), `${channelId}:${signalId}`, INDEX_TTL_SECONDS),
			this.deps.cacheService.sadd(ACTIVE_USERS_KEY, userKey, INDEX_TTL_SECONDS),
		]);
		await this.dispatchChannelUpdate(channel, config.version, [toEntry(entry)], []);
	}

	async deactivate({
		authChannel,
		userId,
		signalId,
	}: {
		authChannel: AuthenticatedChannel;
		userId: UserID;
		signalId: string;
	}): Promise<void> {
		const {channel} = authChannel;
		const removed = await this.removeEntries([{channelId: channel.id.toString(), signalId, userId: userId.toString()}]);
		if (removed.length > 0) {
			const config = await this.getConfig();
			await this.dispatchChannelUpdate(channel, config.version, [], removed);
		}
	}

	async reset({
		authChannel,
		userId,
		signalId,
	}: {
		authChannel: AuthenticatedChannel;
		userId: UserID;
		signalId: string;
	}): Promise<void> {
		const {channel} = authChannel;
		await this.assertCanManageChannel(authChannel, userId);
		const channelId = channel.id.toString();
		const entries = (await this.readChannelEntries(channelId)).filter((entry) => entry.signal_id === signalId);
		const removed = await this.removeEntries(entries.map((entry) => ({channelId, signalId, userId: entry.user.id})));
		if (removed.length > 0) {
			const config = await this.getConfig();
			await this.dispatchChannelUpdate(channel, config.version, [], removed);
		}
	}

	private async removeEntries(
		targets: Array<{channelId: string; signalId: string; userId: string}>,
	): Promise<ChannelSignalUpdateEvent['removed']> {
		const removed: ChannelSignalUpdateEvent['removed'] = [];
		for (const {channelId, signalId, userId} of targets) {
			const key = entryKey(channelId, signalId, userId);
			const existed = await this.deps.cacheService.exists(key);
			await Promise.all([
				this.deps.cacheService.delete(key),
				this.deps.cacheService.srem(channelIndexKey(channelId), `${signalId}:${userId}`),
				this.deps.cacheService.srem(userIndexKey(userId), `${channelId}:${signalId}`),
			]);
			if (existed) {
				removed.push({signal_id: signalId, user_id: userId});
			}
		}
		return removed;
	}

	private async dispatchChannelUpdate(
		channel: Channel,
		barVersion: number,
		added: ChannelSignalUpdateEvent['added'],
		removed: ChannelSignalUpdateEvent['removed'],
	): Promise<void> {
		const data: ChannelSignalUpdateEvent = {
			channel_id: channel.id.toString(),
			bar_version: barVersion,
			added,
			removed,
		};
		await dispatchChannelEvent({
			gatewayService: this.deps.gatewayService,
			channel,
			event: 'CHANNEL_SIGNAL_UPDATE',
			data,
		});
	}

	private async pruneDeletedEmoji(): Promise<SignalBarConfig> {
		const config = await this.getConfig();
		const kept: Array<SignalBarSignal> = [];
		for (const signal of config.signals) {
			if (!signal.emoji_id || (await this.deps.guildRepository.getEmojiById(createEmojiID(BigInt(signal.emoji_id))))) {
				kept.push(signal);
			}
		}
		if (kept.length === config.signals.length) return config;
		const next = {version: config.version + 1, signals: kept};
		await this.writeConfig(next);
		return next;
	}

	async sweep(): Promise<{cleared: number}> {
		const config = await this.pruneDeletedEmoji();
		const signalIds = new Set(config.signals.map((signal) => signal.id));
		const userIds = Array.from(await this.deps.cacheService.smembers(ACTIVE_USERS_KEY));
		const removedByChannel = new Map<string, ChannelSignalUpdateEvent['removed']>();
		for (const userId of userIds) {
			const members = Array.from(await this.deps.cacheService.smembers(userIndexKey(userId)));
			if (members.length === 0) {
				await this.deps.cacheService.srem(ACTIVE_USERS_KEY, userId);
				continue;
			}
			const targets = members.map((member) => {
				const [channelId, signalId] = member.split(':') as [string, string];
				return {channelId, signalId, userId};
			});
			let stale = targets.filter((target) => !signalIds.has(target.signalId));
			if (await this.isOnline(userId)) {
				await this.deps.cacheService.delete(offlineMissKey(userId));
				await Promise.all(
					targets
						.filter((target) => signalIds.has(target.signalId))
						.map(async (target) => {
							const key = entryKey(target.channelId, target.signalId, userId);
							if (await this.deps.cacheService.exists(key)) {
								await this.deps.cacheService.expire(key, ENTRY_TTL_SECONDS);
							} else {
								stale.push(target);
							}
						}),
				);
			} else {
				const misses = ((await this.deps.cacheService.get<number>(offlineMissKey(userId))) ?? 0) + 1;
				if (misses >= OFFLINE_MISSES_BEFORE_CLEAR) {
					stale = targets;
					await this.deps.cacheService.delete(offlineMissKey(userId));
				} else {
					await this.deps.cacheService.set(offlineMissKey(userId), misses, OFFLINE_MISS_TTL_SECONDS);
				}
			}
			for (const target of stale) {
				const removed = await this.removeEntries([target]);
				if (removed.length === 0) continue;
				const list = removedByChannel.get(target.channelId) ?? [];
				list.push(...removed);
				removedByChannel.set(target.channelId, list);
			}
		}
		let cleared = 0;
		for (const [channelId, removed] of removedByChannel) {
			cleared += removed.length;
			const channel = await this.deps.findChannel(createChannelID(BigInt(channelId)));
			if (channel) await this.dispatchChannelUpdate(channel, config.version, [], removed);
		}
		return {cleared};
	}

	private async isOnline(userId: string): Promise<boolean> {
		try {
			return await this.deps.gatewayService.hasActivePresence(createUserID(BigInt(userId)));
		} catch (error) {
			Logger.warn({err: error, userId}, 'Signal bar sweep could not check presence, keeping signals');
			return true;
		}
	}
}
