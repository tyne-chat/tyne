// SPDX-License-Identifier: AGPL-3.0-or-later

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import type {Channel} from '@app/features/channel/models/Channel';
import GuildList from '@app/features/guild/state/GuildList';
import Permission from '@app/features/permissions/state/Permission';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {GuildCommandResponse} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {type IReactionDisposer, makeAutoObservable, observable, reaction, runInAction} from 'mobx';

// Fork: the commands of every community the user belongs to, for the composer
// (docs/design/server-commands.md, "Web client"). Loaded with one request on first use; an event or
// joining a community marks one community stale, and the next use fetches only that community.

const logger = new Logger('GuildCommands');
/** After a failed request, nothing is asked again for this long. */
const FAILURE_COOLDOWN_MS = 30_000;
/** With more stale communities than this, one request reloads them all instead of one each. */
const MAX_GUILD_REFRESHES = 3;

class GuildCommandsStore {
	/** Commands by community, for the communities loaded. */
	private readonly byGuild = observable.map<string, ReadonlyArray<GuildCommandResponse>>(undefined, {deep: false});
	private readonly staleGuilds = observable.set<string>();
	loaded = false;
	private listRequest: Promise<void> | null = null;
	private readonly guildRequests = new Map<string, Promise<void>>();
	private failedAt = 0;
	private stopWatchingGuildList: IReactionDisposer | null = null;

	constructor() {
		makeAutoObservable<this, 'listRequest' | 'guildRequests' | 'failedAt' | 'stopWatchingGuildList'>(
			this,
			{listRequest: false, guildRequests: false, failedAt: false, stopWatchingGuildList: false},
			{autoBind: true},
		);
	}

	/** Started on the first load, not on import: until then there is nothing to update. */
	private watchGuildList(): void {
		this.stopWatchingGuildList ??= reaction(
			() => GuildList.guilds.map((guild) => guild.id),
			(ids, previous) => this.applyGuildList(ids, previous ?? []),
		);
	}

	/** Forget everything (READY, account switch); the next use loads again. */
	invalidate(): void {
		this.byGuild.clear();
		this.staleGuilds.clear();
		this.loaded = false;
		this.listRequest = null;
		this.guildRequests.clear();
		this.failedAt = 0;
	}

	markStale(guildId: string): void {
		if (this.loaded) this.staleGuilds.add(guildId);
	}

	private applyGuildList(ids: ReadonlyArray<string>, previous: ReadonlyArray<string>): void {
		if (!this.loaded) return;
		const now = new Set(ids);
		for (const id of previous) {
			if (!now.has(id)) {
				this.byGuild.delete(id);
				this.staleGuilds.delete(id);
			}
		}
		const before = new Set(previous);
		for (const id of ids) {
			if (!before.has(id)) this.staleGuilds.add(id);
		}
	}

	private coolingDown(): boolean {
		return this.failedAt !== 0 && Date.now() - this.failedAt < FAILURE_COOLDOWN_MS;
	}

	/**
	 * Loads every community's commands once, sharing the request; then refreshes stale ones. A use
	 * sends at most `MAX_GUILD_REFRESHES` requests: beyond that, the list request reloads them all.
	 */
	async ensureLoaded(): Promise<void> {
		if (!this.loaded || this.staleGuilds.size > MAX_GUILD_REFRESHES) {
			if (this.coolingDown()) return;
			this.listRequest ??= this.fetchAll().finally(() => {
				this.listRequest = null;
			});
			await this.listRequest;
			return;
		}
		await Promise.all(Array.from(this.staleGuilds, (guildId) => this.refreshGuild(guildId)));
	}

	private async fetchAll(): Promise<void> {
		try {
			const res = await http.get<Array<GuildCommandResponse>>(ForkEndpoints.USER_GUILD_COMMANDS);
			if (!res.ok || !res.body) {
				this.failedAt = Date.now();
				return;
			}
			const grouped = new Map<string, Array<GuildCommandResponse>>();
			for (const command of res.body) {
				const list = grouped.get(command.guild_id);
				if (list) list.push(command);
				else grouped.set(command.guild_id, [command]);
			}
			runInAction(() => {
				this.byGuild.replace(grouped);
				this.staleGuilds.clear();
				this.loaded = true;
				this.failedAt = 0;
			});
			this.watchGuildList();
		} catch (error) {
			logger.warn('Failed to load commands', error);
			this.failedAt = Date.now();
		}
	}

	private refreshGuild(guildId: string): Promise<void> {
		if (this.coolingDown()) return Promise.resolve();
		const existing = this.guildRequests.get(guildId);
		if (existing) return existing;
		const request = (async () => {
			try {
				const res = await http.get<Array<GuildCommandResponse>>(ForkEndpoints.GUILD_COMMANDS(guildId));
				if (!res.ok || !res.body) {
					this.failedAt = Date.now();
					return;
				}
				const commands = res.body.map(({template: _template, ...command}) => command);
				runInAction(() => {
					this.byGuild.set(guildId, commands);
					this.staleGuilds.delete(guildId);
				});
			} catch (error) {
				logger.warn('Failed to refresh commands', error);
				this.failedAt = Date.now();
			} finally {
				this.guildRequests.delete(guildId);
			}
		})();
		this.guildRequests.set(guildId, request);
		return request;
	}

	/**
	 * The commands usable in `channel`, in precedence order: the channel's community first, then the
	 * user's communities in sidebar order. Another community's commands need Use External Commands in
	 * a community channel; in DMs every community's commands work.
	 */
	usableIn(channel: Channel | null | undefined): ReadonlyArray<GuildCommandResponse> {
		if (!channel) return [];
		const channelGuildId = channel.guildId ?? null;
		const order = GuildList.guilds.map((guild) => guild.id);
		if (channelGuildId) {
			const index = order.indexOf(channelGuildId);
			if (index > 0) {
				order.splice(index, 1);
				order.unshift(channelGuildId);
			}
		}
		const external = channelGuildId === null || Permission.can(Permissions.USE_EXTERNAL_COMMANDS, channel);
		const result: Array<GuildCommandResponse> = [];
		for (const guildId of order) {
			if (channelGuildId !== null && guildId !== channelGuildId && !external) continue;
			result.push(...(this.byGuild.get(guildId) ?? []));
		}
		return result;
	}

	/** The command `/name` resolves to in `channel`, by precedence; null when none. */
	resolve(channel: Channel | null | undefined, name: string): GuildCommandResponse | null {
		return this.usableIn(channel).find((command) => command.name === name) ?? null;
	}

	findById(commandId: string): GuildCommandResponse | null {
		for (const commands of this.byGuild.values()) {
			const found = commands.find((command) => command.id === commandId);
			if (found) return found;
		}
		return null;
	}
}

export default new GuildCommandsStore();
