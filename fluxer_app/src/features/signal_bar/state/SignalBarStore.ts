// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import Authentication from '@app/features/auth/state/Authentication';
import Drafts from '@app/features/messaging/state/MessagingDrafts';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import Users from '@app/features/user/state/Users';
import type {MessageSubprofileRequest} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import type {
	ChannelSignalBarUpdateEvent,
	ChannelSignalEntry,
	ChannelSignalsResponse,
	ChannelSignalUpdateEvent,
	GuildSignalBarSettings,
	SignalBarResponse,
	SignalBarSignal,
	SignalBarUpdateRequest,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {makeAutoObservable, observable, reaction, runInAction} from 'mobx';

const logger = new Logger('SignalBar');
const EMPTY_SIGNALS: ReadonlyArray<SignalBarSignal> = Object.freeze([]);
const EMPTY_ENTRIES: ReadonlyArray<ChannelSignalEntry> = Object.freeze([]);
const COLLAPSED_STORAGE_KEY = 'signalBarCollapsed';

function isSameEntry(entry: ChannelSignalEntry, signalId: string, userId: string): boolean {
	return entry.signal_id === signalId && entry.user.id === userId;
}

function readCollapsed(): boolean {
	try {
		return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

class SignalBarStore {
	signals: ReadonlyArray<SignalBarSignal> = EMPTY_SIGNALS;
	version = -1;
	guildId: string | null = null;
	canManage = false;
	collapsed = readCollapsed();
	epoch = 0;
	private readonly entriesByChannel = observable.map<string, ReadonlyArray<ChannelSignalEntry>>(undefined, {
		deep: false,
	});
	private readonly enabledByChannel = observable.map<string, boolean>();
	private readonly composerPersonas = observable.map<string, MessageSubprofileRequest | null>(undefined, {
		deep: false,
	});
	private configRequest: Promise<void> | null = null;

	constructor() {
		makeAutoObservable<this, 'configRequest'>(this, {configRequest: false}, {autoBind: true});
		reaction(
			() => JSON.stringify(this.ownPersonaByChannel),
			(current, previous) => this.syncOwnPersona(JSON.parse(current), JSON.parse(previous)),
		);
	}

	setComposerPersona(channelId: string, subprofile: MessageSubprofileRequest | null): void {
		const current = this.composerPersonas.get(channelId);
		if (current !== undefined && (current?.id ?? null) === (subprofile?.id ?? null)) return;
		this.composerPersonas.set(channelId, subprofile);
	}

	clearComposerPersona(channelId: string): void {
		this.composerPersonas.delete(channelId);
	}

	getEffectivePersonaId(channelId: string): string | null {
		const live = this.composerPersonas.get(channelId);
		if (live !== undefined) return live?.id ?? null;
		return PersonaStore.getEffectivePersonaForText(Drafts.getDraft(channelId), false).persona?.id ?? null;
	}

	private get ownPersonaByChannel(): Record<string, string | null> {
		const userId = Authentication.currentUserId;
		const result: Record<string, string | null> = {};
		if (!userId) return result;
		for (const [channelId, entries] of this.entriesByChannel) {
			if (entries.some((entry) => entry.user.id === userId)) {
				result[channelId] = this.getEffectivePersonaId(channelId);
			}
		}
		return result;
	}

	private syncOwnPersona(current: Record<string, string | null>, previous: Record<string, string | null>): void {
		const userId = Authentication.currentUserId;
		if (!userId) return;
		for (const [channelId, personaId] of Object.entries(current)) {
			if (!(channelId in previous) || previous[channelId] === personaId) continue;
			const entries = this.entriesByChannel.get(channelId) ?? EMPTY_ENTRIES;
			const live = this.composerPersonas.get(channelId);
			const subprofile = personaId === null ? null : live?.id === personaId ? live : undefined;
			const stale = entries.filter((entry) => entry.user.id === userId && (entry.persona_id ?? null) !== personaId);
			if (stale.length === 0) continue;
			if (subprofile !== undefined) {
				this.entriesByChannel.set(
					channelId,
					entries.map((entry) =>
						stale.includes(entry)
							? {...entry, persona_id: personaId, subprofile: subprofile as ChannelSignalEntry['subprofile']}
							: entry,
					),
				);
			}
			for (const entry of stale) {
				void this.activate(channelId, entry.signal_id, personaId);
			}
		}
	}

	/** Whether the bar is switched on in a channel. Unknown channels count as off. */
	isEnabled(channelId: string): boolean {
		return this.enabledByChannel.get(channelId) ?? false;
	}

	getEntries(channelId: string, signalId: string): ReadonlyArray<ChannelSignalEntry> {
		const entries = this.entriesByChannel.get(channelId);
		if (!entries) return EMPTY_ENTRIES;
		return entries.filter((entry) => entry.signal_id === signalId);
	}

	setCollapsed(collapsed: boolean): void {
		this.collapsed = collapsed;
		try {
			localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
		} catch {}
	}

	invalidate(): void {
		this.entriesByChannel.clear();
		this.enabledByChannel.clear();
		this.epoch += 1;
		void this.fetchConfig();
	}

	fetchConfig(): Promise<void> {
		this.configRequest ??= (async () => {
			try {
				const res = await http.get<SignalBarResponse>(Endpoints.INSTANCE_SIGNAL_BAR);
				if (res.ok && res.body) this.applyConfig(res.body);
			} catch (err) {
				logger.error('Error fetching signal bar', err);
			} finally {
				this.configRequest = null;
			}
		})();
		return this.configRequest;
	}

	private applyConfig(config: SignalBarResponse): void {
		runInAction(() => {
			this.signals = config.signals;
			this.version = config.version;
			this.guildId = config.guild_id;
			this.canManage = config.can_manage;
		});
	}

	private ensureVersion(version: number): void {
		if (version > this.version) void this.fetchConfig();
	}

	async fetchChannel(channelId: string): Promise<void> {
		try {
			const res = await http.get<ChannelSignalsResponse>(Endpoints.CHANNEL_SIGNALS(channelId));
			if (!res.ok || !res.body) return;
			const {entries, bar_version, enabled} = res.body;
			this.rememberEntries(entries);
			runInAction(() => {
				this.entriesByChannel.set(channelId, entries);
				this.enabledByChannel.set(channelId, enabled);
			});
			this.ensureVersion(bar_version);
		} catch (err) {
			logger.error('Error fetching channel signals', err);
		}
	}

	private rememberEntries(entries: ReadonlyArray<ChannelSignalEntry>): void {
		if (entries.length === 0) return;
		Users.cacheUsers(entries.map((entry) => entry.user));
		for (const entry of entries) {
			if (entry.subprofile) PersonaStore.recordKnownPersona(entry.subprofile);
		}
	}

	handleChannelUpdate(event: ChannelSignalUpdateEvent): void {
		this.ensureVersion(event.bar_version);
		const current = this.entriesByChannel.get(event.channel_id);
		if (!current) return;
		this.rememberEntries(event.added);
		const next = current.filter(
			(entry) => !event.removed.some((removed) => isSameEntry(entry, removed.signal_id, removed.user_id)),
		);
		for (const added of event.added) {
			const index = next.findIndex((entry) => isSameEntry(entry, added.signal_id, added.user.id));
			if (index === -1) {
				next.push(added);
			} else {
				next[index] = added;
			}
		}
		this.entriesByChannel.set(event.channel_id, next);
	}

	handleEnabledUpdate(event: ChannelSignalBarUpdateEvent): void {
		this.enabledByChannel.set(event.channel_id, event.enabled);
		if (!event.enabled || !this.entriesByChannel.has(event.channel_id)) {
			this.entriesByChannel.set(event.channel_id, EMPTY_ENTRIES);
		}
	}

	async setDmEnabled(channelId: string, enabled: boolean): Promise<void> {
		try {
			await http.put(Endpoints.CHANNEL_SIGNAL_BAR(channelId), {body: {enabled}});
		} catch (err) {
			logger.error('Error switching the signal bar', err);
			void this.fetchChannel(channelId);
		}
	}

	async removeUser(channelId: string, signalId: string, userId: string): Promise<void> {
		this.removeLocal(channelId, signalId, userId);
		try {
			await http.delete(Endpoints.CHANNEL_SIGNAL_USER(channelId, signalId, userId));
		} catch (err) {
			logger.error("Error turning off someone's signal", err);
			void this.fetchChannel(channelId);
		}
	}

	async fetchGuildSettings(guildId: string): Promise<GuildSignalBarSettings | null> {
		try {
			const res = await http.get<GuildSignalBarSettings>(Endpoints.GUILD_SIGNAL_BAR_CHANNELS(guildId));
			return res.ok && res.body ? res.body : null;
		} catch (err) {
			logger.error('Error fetching signal bar channels', err);
			return null;
		}
	}

	async saveGuildSettings(guildId: string, settings: GuildSignalBarSettings): Promise<GuildSignalBarSettings | null> {
		try {
			const res = await http.put<GuildSignalBarSettings>(Endpoints.GUILD_SIGNAL_BAR_CHANNELS(guildId), {
				body: settings,
			});
			return res.ok && res.body ? res.body : null;
		} catch (err) {
			logger.error('Error saving signal bar channels', err);
			return null;
		}
	}

	handleBarUpdate(version: number): void {
		this.ensureVersion(version);
	}

	private removeLocal(channelId: string, signalId: string, userId: string): void {
		const current = this.entriesByChannel.get(channelId);
		if (!current) return;
		this.entriesByChannel.set(
			channelId,
			current.filter((entry) => !isSameEntry(entry, signalId, userId)),
		);
	}

	async activate(channelId: string, signalId: string, personaId: string | null): Promise<void> {
		try {
			await http.put(Endpoints.CHANNEL_SIGNAL_ME(channelId, signalId), {
				body: personaId ? {persona_id: personaId} : {},
			});
		} catch (err) {
			logger.error('Error giving signal', err);
			void this.fetchChannel(channelId);
		}
	}

	async deactivate(channelId: string, signalId: string): Promise<void> {
		const userId = Authentication.currentUserId;
		if (userId) this.removeLocal(channelId, signalId, userId);
		try {
			await http.delete(Endpoints.CHANNEL_SIGNAL_ME(channelId, signalId));
		} catch (err) {
			logger.error('Error withdrawing signal', err);
			void this.fetchChannel(channelId);
		}
	}

	async reset(channelId: string, signalId: string): Promise<void> {
		try {
			await http.delete(Endpoints.CHANNEL_SIGNAL(channelId, signalId));
		} catch (err) {
			logger.error('Error resetting signal', err);
			void this.fetchChannel(channelId);
		}
	}

	async saveSignals(signals: ReadonlyArray<SignalBarSignal>): Promise<boolean> {
		const previous = this.signals;
		this.signals = signals;
		const body: SignalBarUpdateRequest = {
			signals: signals.map((signal) => ({
				id: signal.id || null,
				emoji_id: signal.emoji_id,
				emoji_name: signal.emoji_name,
				label: signal.label,
			})),
		};
		try {
			const res = await http.put<SignalBarResponse>(Endpoints.INSTANCE_SIGNAL_BAR, {body});
			if (res.ok && res.body) {
				this.applyConfig(res.body);
				return true;
			}
		} catch (err) {
			logger.error('Error saving signal bar', err);
		}
		runInAction(() => {
			this.signals = previous;
		});
		void this.fetchConfig();
		return false;
	}
}

export default new SignalBarStore();
