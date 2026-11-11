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
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
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
	MAX_USER_SIGNAL_CHATS,
	resolveSignalBarEnabled,
	type SignalBarConfig,
	SignalBarConfigSchema,
	type SignalBarResponse,
	type SignalBarSignal,
	type SignalBarUpdateRequest,
	type UserSignalRef,
	type UserSignalsResponse,
	type UserSignalsRestoreAction,
	type UserSignalsRestoreResponse,
	type UserSignalsSnapshot,
	UserSignalsSnapshotSchema,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import type {ICacheService} from '@pkgs/cache/src/ICacheService';

const SIGNAL_BAR_CONFIG_KEY = 'signal_bar';
const EMPTY_CONFIG: SignalBarConfig = {version: 0, signals: []};
const ENTRY_TTL_SECONDS = 600;
const INDEX_TTL_SECONDS = 7 * 24 * 60 * 60;
const OFFLINE_GRACE_MS = 12 * 60 * 60 * 1000;
const OFFLINE_SINCE_TTL_SECONDS = 24 * 60 * 60;
const NO_PERSONA = '0';
const ACTIVE_USERS_KEY = 'signalbar:users';
const UNICODE_EMOJI_REGEX = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣/u;
const GUILD_DISPATCH_PAGE_SIZE = 100;

const entryKey = (channelId: string, signalId: string, userId: string) =>
	`signalbar:entry:${channelId}:${signalId}:${userId}`;
const channelIndexKey = (channelId: string) => `signalbar:channel:${channelId}`;
const userIndexKey = (userId: string) => `signalbar:user:${userId}`;
const offlineSinceKey = (userId: string) => `signalbar:offline_since:${userId}`;
/** What the last change everywhere replaced, kept until the next one (no TTL). */
const restoreKey = (userId: string) => `signalbar:restore:${userId}`;

interface StoredEntry extends ChannelSignalEntry {
	channel_id: string;
}

/** Opens a chat for the acting user, or null when they cannot see it any more. */
export type SignalChatAuthenticator = (channelId: string) => Promise<AuthenticatedChannel | null>;

interface ResolvedPersona {
	personaId: string | null;
	subprofile: ChannelSignalEntry['subprofile'];
}

interface SignalBarServiceDeps {
	instanceConfigRepository: InstanceConfigRepository;
	cacheService: ICacheService;
	gatewayService: IGatewayService;
	guildRepository: GuildRepository;
	personaRepository: IPersonaRepository;
	settingsRepository: SignalBarSettingsRepository;
	findUser: (userId: UserID) => Promise<User | null>;
	findChannel: (channelId: ChannelID) => Promise<Channel | null>;
	listGuildChannels: (guildId: GuildID) => Promise<Array<Channel>>;
	now?: () => number;
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
			const everywhere = item.everywhere ?? current.signals.find((signal) => signal.id === id)?.everywhere ?? false;
			signals.push({id, emoji_id: emojiId, emoji_name: emojiName, animated, label: item.label || null, everywhere});
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

	/** Anyone in a DM or group DM may switch its bar; `getChannelAuthenticated` has checked they are in it. */
	async setDmEnabled(authChannel: AuthenticatedChannel, enabled: boolean): Promise<void> {
		const {channel} = authChannel;
		this.ensureTextChannel(channel);
		if (channel.guildId) throw new MissingPermissionsError();
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
		const persona = await this.resolvePersona(userId, personaId);
		const added = await this.writeEntry(channel, signalId, user, persona);
		if (added) await this.dispatchChannelUpdate(channel, config.version, [added], []);
	}

	/** The persona a signal is shown as; throws `PersonaNotFoundError` for one the user does not own. */
	private async resolvePersona(userId: UserID, personaId: string | null | undefined): Promise<ResolvedPersona> {
		if (!personaId || personaId === NO_PERSONA) return {personaId: null, subprofile: null};
		const persona = await this.deps.personaRepository.findById(userId, createPersonaID(BigInt(personaId)));
		if (!persona || persona.isDeleted) throw new PersonaNotFoundError();
		return {
			personaId: persona.id.toString(),
			subprofile: persona.toSubprofileResponse(await this.deps.personaRepository.findSettings(userId)),
		};
	}

	/** As `resolvePersona`, but a persona deleted since falls back to the account. */
	private async resolvePersonaOrAccount(userId: UserID, personaId: string | null): Promise<ResolvedPersona> {
		try {
			return await this.resolvePersona(userId, personaId);
		} catch (error) {
			if (error instanceof PersonaNotFoundError) return {personaId: null, subprofile: null};
			throw error;
		}
	}

	/**
	 * Lights a signal or re-points it to another persona, keeping its place. Returns the entry to send
	 * under `added`, or null when it was already lit as that persona (its TTL is renewed).
	 */
	private async writeEntry(
		channel: Channel,
		signalId: string,
		user: User,
		persona: ResolvedPersona,
	): Promise<ChannelSignalEntry | null> {
		const channelId = channel.id.toString();
		const userKey = user.id.toString();
		const key = entryKey(channelId, signalId, userKey);
		const existing = ChannelSignalEntrySchema.safeParse(await this.deps.cacheService.get<unknown>(key));
		if (existing.success && existing.data.persona_id === persona.personaId) {
			await this.deps.cacheService.expire(key, ENTRY_TTL_SECONDS);
			return null;
		}
		const entry: StoredEntry = {
			channel_id: channelId,
			signal_id: signalId,
			user: mapUserToPartialResponse(user),
			persona_id: persona.personaId,
			subprofile: persona.subprofile,
			activated_at: existing.success ? existing.data.activated_at : Date.now(),
		};
		await this.deps.cacheService.set(key, entry, ENTRY_TTL_SECONDS);
		await Promise.all([
			this.deps.cacheService.sadd(channelIndexKey(channelId), `${signalId}:${userKey}`, INDEX_TTL_SECONDS),
			this.deps.cacheService.sadd(userIndexKey(userKey), `${channelId}:${signalId}`, INDEX_TTL_SECONDS),
			this.deps.cacheService.sadd(ACTIVE_USERS_KEY, userKey, INDEX_TTL_SECONDS),
		]);
		return toEntry(entry);
	}

	/** Whether the user may light signals in a chat now: the checks `activate` makes, without throwing. */
	private async canLight(authChannel: AuthenticatedChannel): Promise<boolean> {
		const {channel} = authChannel;
		if (!TEXT_BASED_CHANNEL_TYPES.has(channel.type)) return false;
		try {
			assertGuildMemberCanCommunicate(authChannel.member);
			if (channel.guildId) await authChannel.checkPermission(Permissions.SEND_MESSAGES);
		} catch {
			return false;
		}
		return this.isChannelEnabled(channel);
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

	/** The user's lit signals, grouped by chat, oldest first within each; signals no longer on the bar are left out. */
	private async readUserChats(userId: string, config: SignalBarConfig): Promise<Map<string, Array<StoredEntry>>> {
		const members = Array.from(await this.deps.cacheService.smembers(userIndexKey(userId)));
		const chats = new Map<string, Array<StoredEntry>>();
		if (members.length === 0) return chats;
		const signalIds = new Set(config.signals.map((signal) => signal.id));
		const values = await this.deps.cacheService.mget<unknown>(
			members.map((member) => {
				const [channelId, signalId] = member.split(':') as [string, string];
				return entryKey(channelId, signalId, userId);
			}),
		);
		await Promise.all(
			members.map(async (member, index) => {
				const parsed = ChannelSignalEntrySchema.safeParse(values[index]);
				if (!parsed.success) {
					await this.deps.cacheService.srem(userIndexKey(userId), member);
					return;
				}
				if (!signalIds.has(parsed.data.signal_id)) return;
				const channelId = member.split(':')[0]!;
				const list = chats.get(channelId) ?? [];
				list.push({...parsed.data, channel_id: channelId});
				chats.set(channelId, list);
			}),
		);
		for (const list of chats.values()) list.sort((a, b) => a.activated_at - b.activated_at);
		return chats;
	}

	private toRefs(entries: Array<StoredEntry>): Array<UserSignalRef> {
		return entries.map((entry) => ({signal_id: entry.signal_id, persona_id: entry.persona_id}));
	}

	private async readSnapshot(userId: string): Promise<UserSignalsSnapshot | null> {
		const parsed = UserSignalsSnapshotSchema.safeParse(await this.deps.cacheService.get<unknown>(restoreKey(userId)));
		return parsed.success ? parsed.data : null;
	}

	/** Saves what a change everywhere replaced; a change that changed nothing keeps the previous one. */
	private async writeSnapshot(
		userId: string,
		action: UserSignalsRestoreAction,
		chats: UserSignalsSnapshot['chats'],
	): Promise<void> {
		if (chats.length === 0) return;
		const snapshot: UserSignalsSnapshot = {created_at: this.deps.now?.() ?? Date.now(), action, chats};
		await this.deps.cacheService.set(restoreKey(userId), snapshot);
	}

	/** Every chat where the user has a signal on, newest first, and whether Restore has anything to undo. */
	async getUserSignals(userId: UserID): Promise<UserSignalsResponse> {
		const userKey = userId.toString();
		const config = await this.getConfig();
		const [chats, restoreAvailable] = await Promise.all([
			this.readUserChats(userKey, config),
			this.deps.cacheService.exists(restoreKey(userKey)),
		]);
		return {
			chats: Array.from(chats, ([channelId, entries]) => ({
				channel_id: channelId,
				signals: this.toRefs(entries),
				updated_at: Math.max(...entries.map((entry) => entry.activated_at)),
			})).sort((a, b) => b.updated_at - a.updated_at),
			restore_available: restoreAvailable,
		};
	}

	/**
	 * Sets one signal in every chat where the user has one on, and in the open chat, turning their
	 * others there off; or, with no signal, turns every signal of theirs off. Each chat keeps the
	 * persona its newest signal showed; the open chat uses `personaId`. Chats where the user may no
	 * longer light signals are left alone when setting. Saves what it replaced for Restore.
	 */
	async setEverywhere({
		userId,
		signalId,
		openChannelId,
		personaId,
		authenticate,
	}: {
		userId: UserID;
		signalId: string | null;
		openChannelId?: string | null;
		personaId?: string | null;
		authenticate: SignalChatAuthenticator;
	}): Promise<UserSignalsResponse> {
		const config = await this.getConfig();
		if (signalId !== null && !config.signals.some((signal) => signal.id === signalId && signal.everywhere)) {
			throw signalId && config.signals.some((signal) => signal.id === signalId)
				? new MissingPermissionsError()
				: new UnknownSignalError();
		}
		const user = await this.deps.findUser(userId);
		if (!user) throw new MissingPermissionsError();
		const openPersona = signalId !== null && openChannelId ? await this.resolvePersona(userId, personaId) : null;
		const userKey = userId.toString();
		const current = await this.readUserChats(userKey, config);
		const channelIds = Array.from(current.keys()).filter((channelId) => channelId !== openChannelId);
		if (openPersona && openChannelId) channelIds.unshift(openChannelId);
		const replaced: UserSignalsSnapshot['chats'] = [];
		for (const channelId of channelIds.slice(0, MAX_USER_SIGNAL_CHATS)) {
			const before = current.get(channelId) ?? [];
			const authChannel = await authenticate(channelId);
			let channel = authChannel?.channel ?? null;
			const added: Array<ChannelSignalEntry> = [];
			if (signalId !== null) {
				if (!authChannel || !(await this.canLight(authChannel))) continue;
				const persona =
					channelId === openChannelId && openPersona
						? openPersona
						: await this.resolvePersonaOrAccount(userId, before.at(-1)?.persona_id ?? null);
				const entry = await this.writeEntry(authChannel.channel, signalId, user, persona);
				if (entry) added.push(entry);
			} else if (!channel) {
				channel = await this.deps.findChannel(createChannelID(BigInt(channelId)));
			}
			const removed = await this.removeEntries(
				before
					.filter((entry) => entry.signal_id !== signalId)
					.map((entry) => ({channelId, signalId: entry.signal_id, userId: userKey})),
			);
			if (added.length === 0 && removed.length === 0) continue;
			replaced.push({channel_id: channelId, signals: this.toRefs(before)});
			if (channel) await this.dispatchChannelUpdate(channel, config.version, added, removed);
		}
		await this.writeSnapshot(userKey, {kind: signalId === null ? 'off' : 'set', signal_id: signalId}, replaced);
		return this.getUserSignals(userId);
	}

	/** What Restore would put back, chat by chat, against what is on now. */
	async getRestorePreview(userId: UserID, authenticate: SignalChatAuthenticator): Promise<UserSignalsRestoreResponse> {
		const userKey = userId.toString();
		const snapshot = await this.readSnapshot(userKey);
		if (!snapshot) return {available: false, created_at: null, action: null, chats: []};
		const config = await this.getConfig();
		const signalIds = new Set(config.signals.map((signal) => signal.id));
		const current = await this.readUserChats(userKey, config);
		const chats = await Promise.all(
			snapshot.chats.map(async (chat) => {
				const authChannel = await authenticate(chat.channel_id);
				return {
					channel_id: chat.channel_id,
					available: authChannel !== null && (await this.canLight(authChannel)),
					now: this.toRefs(current.get(chat.channel_id) ?? []),
					after: chat.signals.filter((ref) => signalIds.has(ref.signal_id)),
				};
			}),
		);
		return {available: true, created_at: snapshot.created_at, action: snapshot.action, chats};
	}

	/**
	 * Puts back what the last change everywhere replaced, in the chats where the user may still light
	 * signals, and saves what this replaces in turn, so a second Restore swaps back.
	 */
	async restore(userId: UserID, authenticate: SignalChatAuthenticator): Promise<UserSignalsResponse> {
		const userKey = userId.toString();
		const snapshot = await this.readSnapshot(userKey);
		const user = await this.deps.findUser(userId);
		if (!snapshot || !user) return this.getUserSignals(userId);
		const config = await this.getConfig();
		const signalIds = new Set(config.signals.map((signal) => signal.id));
		const current = await this.readUserChats(userKey, config);
		const replaced: UserSignalsSnapshot['chats'] = [];
		for (const chat of snapshot.chats) {
			const authChannel = await authenticate(chat.channel_id);
			if (!authChannel || !(await this.canLight(authChannel))) continue;
			const before = current.get(chat.channel_id) ?? [];
			const wanted = chat.signals.filter((ref) => signalIds.has(ref.signal_id));
			const added: Array<ChannelSignalEntry> = [];
			for (const ref of wanted) {
				const persona = await this.resolvePersonaOrAccount(userId, ref.persona_id);
				const entry = await this.writeEntry(authChannel.channel, ref.signal_id, user, persona);
				if (entry) added.push(entry);
			}
			const keep = new Set(wanted.map((ref) => ref.signal_id));
			const removed = await this.removeEntries(
				before
					.filter((entry) => !keep.has(entry.signal_id))
					.map((entry) => ({channelId: chat.channel_id, signalId: entry.signal_id, userId: userKey})),
			);
			if (added.length === 0 && removed.length === 0) continue;
			replaced.push({channel_id: chat.channel_id, signals: this.toRefs(before)});
			await this.dispatchChannelUpdate(authChannel.channel, config.version, added, removed);
		}
		await this.writeSnapshot(userKey, {kind: 'restore', signal_id: null}, replaced);
		return this.getUserSignals(userId);
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
			if (await this.offlineTooLong(userId)) {
				stale = targets;
			} else {
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

	private async offlineTooLong(userId: string): Promise<boolean> {
		const key = offlineSinceKey(userId);
		if (await this.isOnline(userId)) {
			await this.deps.cacheService.delete(key);
			return false;
		}
		const now = this.deps.now?.() ?? Date.now();
		const since = await this.deps.cacheService.get<number>(key);
		if (since === null) {
			await this.deps.cacheService.set(key, now, OFFLINE_SINCE_TTL_SECONDS);
			return false;
		}
		if (now - since < OFFLINE_GRACE_MS) return false;
		await this.deps.cacheService.delete(key);
		return true;
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
