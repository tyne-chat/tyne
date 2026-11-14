// SPDX-License-Identifier: AGPL-3.0-or-later

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import Authentication from '@app/features/auth/state/Authentication';
import Drafts from '@app/features/messaging/state/MessagingDrafts';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {makePersistent} from '@app/features/platform/utils/MobXPersistence';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import {decideComposerTyping} from '@app/features/typing/rolling/RollingComposerTypingGate';
import Users from '@app/features/user/state/Users';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import type {
	ChannelSignalBarUpdateEvent,
	ChannelSignalEntry,
	ChannelSignalsResponse,
	ChannelSignalUpdateEvent,
	GuildSignalBarSettings,
	SignalBarResponse,
	SignalBarSignal,
	SignalBarUpdateRequest,
	UserSignalChat,
	UserSignalsResponse,
	UserSignalsRestoreResponse,
	UserSignalsUpdateRequest,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';
import {makeAutoObservable, observable, observableRef, reaction, runInAction} from 'mobx';

const logger = new Logger('SignalBar');
const EMPTY_SIGNALS: ReadonlyArray<SignalBarSignal> = Object.freeze([]);
const EMPTY_ENTRIES: ReadonlyArray<ChannelSignalEntry> = Object.freeze([]);
/** After a failed load of the account's signals everywhere, bars wait this long before asking again. */
const MY_CHATS_RETRY_MS = 60_000;
/** How many chats the device's copy keeps: the most recently loaded (tyne-chat/tyne#645). */
export const SNAPSHOT_CHANNELS = 50;
/** A bar mounting does not ask again for a chat a preload answered this recently. */
export const FRESH_CHANNEL_ANSWER_MS = 10_000;

/** One chat in the device's copy. */
export interface SignalBarSnapshotChannel {
	channel_id: string;
	enabled: boolean;
	entries: ReadonlyArray<ChannelSignalEntry>;
}

/**
 * What the bar showed last, kept on this device for each account in app storage, so that the next
 * start shows it before any request answers (tyne-chat/tyne#645). Plain JSON, never a Map.
 */
export interface SignalBarSnapshot {
	/** The account it belongs to. */
	userId: string;
	signals: ReadonlyArray<SignalBarSignal>;
	version: number;
	/** The most recently loaded chats first, at most `SNAPSHOT_CHANNELS`. */
	channels: ReadonlyArray<SignalBarSnapshotChannel>;
	myChats: ReadonlyArray<UserSignalChat> | null;
	restoreAvailable: boolean;
}

/** A click on a signal of a chat whose copy is not confirmed yet: the state it asked for. */
interface WantedSignal {
	on: boolean;
	/** Whom to light it as, taken at the click. */
	personaId: string | null;
}

/** The snapshot as read back from storage, or null when it is not one. */
function readSnapshot(value: unknown): SignalBarSnapshot | null {
	if (!value || typeof value !== 'object') return null;
	const snapshot = value as Partial<SignalBarSnapshot>;
	if (
		typeof snapshot.userId !== 'string' ||
		!Array.isArray(snapshot.signals) ||
		!Array.isArray(snapshot.channels) ||
		(snapshot.myChats != null && !Array.isArray(snapshot.myChats))
	) {
		return null;
	}
	return snapshot as SignalBarSnapshot;
}

function isSameEntry(entry: ChannelSignalEntry, signalId: string, userId: string): boolean {
	return entry.signal_id === signalId && entry.user.id === userId;
}

/** What the person just did to the composer's text, for telling typing apart from everything else. */
interface ComposerEdit {
	value: string;
	previousValue: string | null;
	/** Whether this composer sends typing indicators at all. */
	typingEnabled: boolean;
}

class SignalBarStore {
	signals: ReadonlyArray<SignalBarSignal> = EMPTY_SIGNALS;
	version = -1;
	guildId: string | null = null;
	canManage = false;
	/** Kept in this device's storage, per account (`makePersistent`); not synced. */
	collapsed = false;
	epoch = 0;
	private readonly entriesByChannel = observable.map<string, ReadonlyArray<ChannelSignalEntry>>(undefined, {
		deep: false,
	});
	private readonly enabledByChannel = observable.map<string, boolean>();
	private readonly composerPersonas = observable.map<string, MessageSubprofileResponse | null>(undefined, {
		deep: false,
	});
	private configRequest: Promise<void> | null = null;
	/**
	 * The account's own signals in every chat, from `GET /users/@me/signals`, kept up to date by the
	 * channel events that carry the account's id. Null until loaded.
	 */
	myChats: ReadonlyMap<string, UserSignalChat> | null = null;
	/** Whether Restore has something to put back. Only this device's own changes update it before READY. */
	restoreAvailable = false;
	/** A change everywhere is on its way; the panel's buttons wait for it. */
	everywhereBusy = false;
	private myChatsRequest: Promise<void> | null = null;
	private myChatsFailedAt = 0;
	/** Whether the summary was answered since the latest READY; until then it is shown unconfirmed. */
	private myChatsConfirmed = false;
	/**
	 * The device's last copy (`SignalBarSnapshot`), kept in app storage per account with `collapsed`
	 * and swapped on an account switch. Written after every change; read only at start and on a switch.
	 */
	snapshot: SignalBarSnapshot | null = null;
	/** The account the copy in memory belongs to; null while there is none. */
	private ownerId: string | null = null;
	/** Chats loaded, the most recent first: the ones the snapshot keeps. */
	private channelOrder: ReadonlyArray<string> = [];
	/** Chats answered since the latest READY. The others are shown as they were, unconfirmed. */
	private readonly confirmedChannels = new Set<string>();
	/** Chats with a request sent since the latest READY still on its way. */
	private readonly loadingChannels = new Set<string>();
	/** Chats a preload is loading, and when a preload last confirmed a chat: for `loadForBar`. */
	private readonly preloadingChannels = new Set<string>();
	private readonly preloadedAt = new Map<string, number>();
	/** Clicks on unconfirmed chats, by chat, then signal, waiting for the chat's answer. */
	private readonly wantedSignals = new Map<string, Map<string, WantedSignal>>();
	/** The bar's version in the copy the store was seeded from, while `version` is still -1. */
	private seededVersion = -1;

	constructor() {
		makeAutoObservable<
			this,
			| 'configRequest'
			| 'myChatsRequest'
			| 'myChatsFailedAt'
			| 'myChatsConfirmed'
			| 'confirmedChannels'
			| 'loadingChannels'
			| 'preloadingChannels'
			| 'preloadedAt'
			| 'wantedSignals'
			| 'seededVersion'
			| 'buildSnapshot'
		>(
			this,
			{
				configRequest: false,
				myChatsRequest: false,
				myChatsFailedAt: false,
				myChatsConfirmed: false,
				confirmedChannels: false,
				loadingChannels: false,
				preloadingChannels: false,
				preloadedAt: false,
				wantedSignals: false,
				seededVersion: false,
				buildSnapshot: false,
				snapshot: observableRef,
			},
			{autoBind: true},
		);
		initializeStore(this, async () => {
			await makePersistent(this, 'SignalBar', ['collapsed', 'snapshot'], {
				// Another account's copy: nothing of the previous account's stays.
				onRehydrated: () => this.replaceWithSnapshot(),
			});
			reaction(
				() => this.buildSnapshot(),
				(snapshot) => {
					if (snapshot) this.setSnapshot(snapshot);
				},
			);
			this.seedFromSnapshot();
		});
	}

	/** The copy to keep on the device, or null while there is nothing of the account's to keep. */
	private buildSnapshot(): SignalBarSnapshot | null {
		const userId = this.ownerId;
		if (!userId || (Authentication.currentUserId && Authentication.currentUserId !== userId)) return null;
		const channels: Array<SignalBarSnapshotChannel> = [];
		for (const channelId of this.channelOrder) {
			const entries = this.entriesByChannel.get(channelId);
			const enabled = this.enabledByChannel.get(channelId);
			if (entries === undefined || enabled === undefined) continue;
			channels.push({channel_id: channelId, enabled, entries});
			if (channels.length === SNAPSHOT_CHANNELS) break;
		}
		return {
			userId,
			signals: this.signals,
			version: this.version >= 0 ? this.version : this.seededVersion,
			channels,
			myChats: this.myChats ? Array.from(this.myChats.values()) : null,
			restoreAvailable: this.restoreAvailable,
		};
	}

	private setSnapshot(snapshot: SignalBarSnapshot): void {
		this.snapshot = snapshot;
	}

	/**
	 * Shows the device's last copy wherever nothing is loaded yet, unconfirmed: each chat until its
	 * answer, the summary until it is loaded again, the bar until `fetchConfig` (tyne-chat/tyne#645).
	 */
	private seedFromSnapshot(): void {
		const snapshot = readSnapshot(this.snapshot);
		if (!snapshot) return;
		const userId = Authentication.currentUserId;
		if ((userId && snapshot.userId !== userId) || (this.ownerId && this.ownerId !== snapshot.userId)) return;
		runInAction(() => {
			this.seededVersion = snapshot.version;
			if (this.signals.length === 0 && this.version < 0) this.signals = snapshot.signals;
			const order = [...this.channelOrder];
			for (const channel of snapshot.channels) {
				if (this.entriesByChannel.has(channel.channel_id)) continue;
				try {
					this.rememberEntries(channel.entries);
				} catch (err) {
					// Early in the start the user store may not take them yet: the badges come with the answer.
					logger.warn('Could not remember the accounts of a kept chat', err);
				}
				this.entriesByChannel.set(channel.channel_id, channel.entries);
				this.enabledByChannel.set(channel.channel_id, channel.enabled);
				if (!order.includes(channel.channel_id)) order.push(channel.channel_id);
			}
			this.channelOrder = order.slice(0, SNAPSHOT_CHANNELS);
			if (this.myChats === null && snapshot.myChats) {
				this.myChats = new Map(snapshot.myChats.map((chat) => [chat.channel_id, chat]));
				this.restoreAvailable = snapshot.restoreAvailable;
			}
			this.ownerId = snapshot.userId;
		});
	}

	/** An account switch: the previous account's chats and summary go, and the new account's copy comes. */
	private replaceWithSnapshot(): void {
		runInAction(() => {
			this.clearAccountData();
			this.seedFromSnapshot();
		});
	}

	private clearAccountData(): void {
		this.entriesByChannel.clear();
		this.enabledByChannel.clear();
		this.channelOrder = [];
		this.confirmedChannels.clear();
		this.loadingChannels.clear();
		this.preloadingChannels.clear();
		this.preloadedAt.clear();
		this.wantedSignals.clear();
		this.forgetMyChats();
		this.ownerId = null;
	}

	/** Whether a chat's copy was answered since the latest READY. */
	isConfirmed(channelId: string): boolean {
		return this.confirmedChannels.has(channelId);
	}

	/**
	 * Records which persona a channel's composer is writing as, which is who a signal lit there
	 * will name. With `edit`, the person changed the text: if that counts as typing, their lit
	 * signals in the channel follow.
	 */
	setComposerPersona(channelId: string, subprofile: MessageSubprofileResponse | null, edit?: ComposerEdit): void {
		const current = this.composerPersonas.get(channelId);
		if (current === undefined || (current?.id ?? null) !== (subprofile?.id ?? null)) {
			this.composerPersonas.set(channelId, subprofile);
		}
		// The same test the typing indicator uses, so a signal never names a persona the indicator would not.
		const typed =
			edit !== undefined &&
			decideComposerTyping({
				previousValue: edit.previousValue,
				value: edit.value,
				isEditingMessageInComposer: false,
				enabled: edit.typingEnabled,
			}) === 'start';
		if (typed) this.affirmPersona(channelId, subprofile);
	}

	clearComposerPersona(channelId: string): void {
		this.composerPersonas.delete(channelId);
	}

	getEffectivePersonaId(channelId: string): string | null {
		const live = this.composerPersonas.get(channelId);
		if (live !== undefined) return live?.id ?? null;
		return PersonaStore.getEffectivePersonaForText(channelId, Drafts.getDraft(channelId), false).persona?.id ?? null;
	}

	/**
	 * Shows the account's lit signals in one channel as `subprofile` (null for the account itself).
	 *
	 * Call it only for something the person did in that channel: typing there, picking a persona in
	 * its composer, sending a message. A signal is seen by everyone in its channel, so it must not
	 * change because the active persona changed in another channel, another window or on another
	 * device. Opening a channel is not a reason either.
	 */
	affirmPersona(channelId: string, subprofile: MessageSubprofileResponse | null): void {
		const userId = Authentication.currentUserId;
		const entries = this.entriesByChannel.get(channelId);
		// An unconfirmed copy may be out of date: the next change after the chat's answer re-points.
		if (!userId || !entries || !this.confirmedChannels.has(channelId)) return;
		const personaId = subprofile?.id ?? null;
		const stale = entries.filter((entry) => entry.user.id === userId && (entry.persona_id ?? null) !== personaId);
		if (stale.length === 0) return;
		this.entriesByChannel.set(
			channelId,
			entries.map((entry) =>
				stale.includes(entry)
					? {...entry, persona_id: personaId, subprofile: subprofile as ChannelSignalEntry['subprofile']}
					: entry,
			),
		);
		for (const entry of stale) {
			void this.activate(channelId, entry.signal_id, personaId);
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
	}

	/**
	 * READY: nothing is dropped (tyne-chat/tyne#644). Every chat and the summary stay shown,
	 * unconfirmed, until their answers; mounted bars ask again on `epoch`. Another account's copy goes.
	 */
	invalidate(): void {
		if (this.ownerId !== null && this.ownerId !== Authentication.currentUserId) this.clearAccountData();
		this.confirmedChannels.clear();
		this.loadingChannels.clear();
		this.preloadingChannels.clear();
		this.preloadedAt.clear();
		this.myChatsConfirmed = false;
		this.epoch += 1;
		// A bar mounting meanwhile may already have asked; ensure shares or skips that request.
		void this.fetchConfig().then(() => {
			if (this.signals.length > 0) this.ensureMyChats();
		});
	}

	/** Drops the account's summary, so the next bar or panel loads it again. */
	forgetMyChats(): void {
		this.myChats = null;
		this.restoreAvailable = false;
		this.myChatsFailedAt = 0;
		this.myChatsConfirmed = false;
	}

	/** The account's signals everywhere, newest first. */
	get myChatList(): ReadonlyArray<UserSignalChat> {
		if (!this.myChats) return [];
		return Array.from(this.myChats.values()).sort((a, b) => b.updated_at - a.updated_at);
	}

	/** Loads the account's signals everywhere, sharing a request in flight. A failure is logged and not retried. */
	fetchMyChats(): Promise<void> {
		this.myChatsRequest ??= (async () => {
			let ok = false;
			const epoch = this.epoch;
			try {
				const res = await http.get<UserSignalsResponse>(ForkEndpoints.USER_SIGNALS);
				if (res.ok && res.body) {
					this.applyMyChats(res.body, epoch);
					ok = true;
				}
			} catch (err) {
				logger.error('Error fetching signals everywhere', err);
			} finally {
				this.myChatsRequest = null;
				this.myChatsFailedAt = ok ? 0 : Date.now();
			}
		})();
		return this.myChatsRequest;
	}

	/**
	 * For a mounting bar: loads the summary once, and again once after READY (until then the copy
	 * stays shown), and after a failure not again for a minute.
	 */
	ensureMyChats(): void {
		if ((this.myChats !== null && this.myChatsConfirmed) || this.myChatsRequest) return;
		if (this.myChatsFailedAt && Date.now() - this.myChatsFailedAt < MY_CHATS_RETRY_MS) return;
		void this.fetchMyChats();
	}

	/** Takes the server's summary; it confirms the copy only if asked for since the latest READY. */
	private applyMyChats(response: UserSignalsResponse, epoch: number): void {
		runInAction(() => {
			this.myChats = new Map(response.chats.map((chat) => [chat.channel_id, chat]));
			this.restoreAvailable = response.restore_available;
			this.ownerId ??= Authentication.currentUserId;
		});
		if (epoch === this.epoch) this.myChatsConfirmed = true;
	}

	/** Keeps `myChats` in step with a channel event that names the account. */
	private trackMyChats(event: ChannelSignalUpdateEvent): void {
		const userId = Authentication.currentUserId;
		if (!this.myChats || !userId) return;
		const removed = event.removed.filter((entry) => entry.user_id === userId);
		const added = event.added.filter((entry) => entry.user.id === userId);
		if (removed.length === 0 && added.length === 0) return;
		const current = this.myChats.get(event.channel_id);
		let signals = (current?.signals ?? []).filter((ref) => !removed.some((entry) => entry.signal_id === ref.signal_id));
		let updatedAt = current?.updated_at ?? 0;
		for (const entry of added) {
			const ref = {signal_id: entry.signal_id, persona_id: entry.persona_id ?? null};
			const index = signals.findIndex((existing) => existing.signal_id === entry.signal_id);
			signals = index === -1 ? [...signals, ref] : signals.map((existing, i) => (i === index ? ref : existing));
			updatedAt = Math.max(updatedAt, entry.activated_at);
		}
		const next = new Map(this.myChats);
		if (signals.length === 0) {
			next.delete(event.channel_id);
		} else {
			next.set(event.channel_id, {channel_id: event.channel_id, signals, updated_at: updatedAt});
		}
		this.myChats = next;
	}

	/**
	 * Sets one signal in every chat where the account has one on, and in `channelId`, turning its others
	 * there off; with `signalId` null, turns every signal of the account's off. One request; the chats
	 * follow through their events.
	 */
	async setEverywhere(signalId: string | null, channelId: string | null, personaId: string | null): Promise<void> {
		const body: UserSignalsUpdateRequest = {signal_id: signalId};
		if (signalId !== null && channelId) {
			body.channel_id = channelId;
			body.persona_id = personaId;
		}
		await this.sendEverywhere(() => http.put<UserSignalsResponse>(ForkEndpoints.USER_SIGNALS, {body}));
	}

	/**
	 * Turns off the account's signals in one chat, from the signals-everywhere panel: the chat leaves
	 * the summary and the channel at once, and one DELETE goes out per signal. A failure reloads the
	 * summary once, and the channel once if it is loaded.
	 */
	async turnOffChat(channelId: string): Promise<void> {
		const userId = Authentication.currentUserId;
		const chat = this.myChats?.get(channelId);
		if (!userId || !chat || !this.myChats) return;
		const next = new Map(this.myChats);
		next.delete(channelId);
		this.myChats = next;
		for (const ref of chat.signals) this.removeLocal(channelId, ref.signal_id, userId);
		const failed = await Promise.all(
			chat.signals.map(async (ref) => {
				try {
					const res = await http.delete(ForkEndpoints.CHANNEL_SIGNAL_ME(channelId, ref.signal_id));
					return !res.ok;
				} catch (err) {
					logger.error('Error turning off signals in a chat', err);
					return true;
				}
			}),
		);
		if (!failed.some(Boolean)) return;
		void this.fetchMyChats();
		if (this.entriesByChannel.has(channelId)) void this.fetchChannel(channelId);
	}

	/** What Restore would change, chat by chat; null when it could not be loaded. */
	async fetchRestorePreview(): Promise<UserSignalsRestoreResponse | null> {
		try {
			const res = await http.get<UserSignalsRestoreResponse>(ForkEndpoints.USER_SIGNALS_RESTORE);
			return res.ok && res.body ? res.body : null;
		} catch (err) {
			logger.error('Error fetching the signals restore preview', err);
			return null;
		}
	}

	async restoreEverywhere(): Promise<void> {
		await this.sendEverywhere(() => http.post<UserSignalsResponse>(ForkEndpoints.USER_SIGNALS_RESTORE));
	}

	private async sendEverywhere(send: () => Promise<{ok: boolean; body?: UserSignalsResponse | null}>): Promise<void> {
		if (this.everywhereBusy) return;
		this.everywhereBusy = true;
		const epoch = this.epoch;
		try {
			const res = await send();
			if (res.ok && res.body) {
				this.applyMyChats(res.body, epoch);
				return;
			}
		} catch (err) {
			logger.error('Error changing signals everywhere', err);
		} finally {
			runInAction(() => {
				this.everywhereBusy = false;
			});
		}
		void this.fetchMyChats();
	}

	fetchConfig(): Promise<void> {
		this.configRequest ??= (async () => {
			try {
				const res = await http.get<SignalBarResponse>(ForkEndpoints.INSTANCE_SIGNAL_BAR);
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

	/**
	 * Loads a chat. An answer to a request sent since the latest READY confirms the chat and sends
	 * the clicks waiting for it; an older answer updates the copy and waits for the newer request the
	 * bar sent on `epoch`. When the newest request fails, the waiting clicks are sent as they are.
	 */
	async fetchChannel(channelId: string): Promise<void> {
		const epoch = this.epoch;
		let answered = false;
		this.loadingChannels.add(channelId);
		try {
			const res = await http.get<ChannelSignalsResponse>(ForkEndpoints.CHANNEL_SIGNALS(channelId));
			// An answer to a request sent before READY never replaces a newer one already shown.
			if (epoch !== this.epoch && this.confirmedChannels.has(channelId)) return;
			if (res.ok && res.body) {
				const {entries, bar_version, enabled} = res.body;
				this.rememberEntries(entries);
				runInAction(() => {
					this.entriesByChannel.set(channelId, entries);
					this.enabledByChannel.set(channelId, enabled);
					this.channelOrder = [channelId, ...this.channelOrder.filter((id) => id !== channelId)].slice(
						0,
						SNAPSHOT_CHANNELS,
					);
					this.ownerId ??= Authentication.currentUserId;
				});
				answered = true;
				this.ensureVersion(bar_version);
			}
		} catch (err) {
			logger.error('Error fetching channel signals', err);
		}
		if (epoch !== this.epoch) return;
		this.loadingChannels.delete(channelId);
		if (answered) this.confirmedChannels.add(channelId);
		this.sendWanted(channelId, answered);
	}

	/**
	 * Starts loading a chat someone is about to open, from upstream's hover and click preload
	 * (`useChannelHoverPreload`), so that a chat not opened before shows its bar with the composer
	 * instead of popping in after it: one request, only with a bar, only for a chat not answered
	 * since the latest READY, and none while one is on its way.
	 */
	preloadChannel(channelId: string): void {
		if (this.signals.length === 0) return;
		if (this.loadingChannels.has(channelId) || this.confirmedChannels.has(channelId)) return;
		this.preloadingChannels.add(channelId);
		const epoch = this.epoch;
		void this.fetchChannel(channelId).finally(() => {
			if (epoch !== this.epoch) return;
			this.preloadingChannels.delete(channelId);
			if (this.confirmedChannels.has(channelId)) this.preloadedAt.set(channelId, Date.now());
		});
	}

	/**
	 * A bar mounting asks for its chat, as on every mount, except that it takes over a preload's
	 * request still on its way, or an answer a preload got less than `FRESH_CHANNEL_ANSWER_MS` ago
	 * (once: the next mount asks again).
	 */
	loadForBar(channelId: string): void {
		if (this.preloadingChannels.has(channelId)) return;
		const preloadedAt = this.preloadedAt.get(channelId);
		this.preloadedAt.delete(channelId);
		if (
			preloadedAt !== undefined &&
			this.confirmedChannels.has(channelId) &&
			Date.now() - preloadedAt < FRESH_CHANNEL_ANSWER_MS
		) {
			return;
		}
		void this.fetchChannel(channelId);
	}

	/**
	 * A click on a signal of the bar: turns the account's own off, or lights it as the composer here
	 * writes. On a chat whose copy is not confirmed (from the device, or from before READY), the click
	 * is remembered as the state it asks for, the last click winning, and sent once the chat answers,
	 * only if the answer differs (tyne-chat/tyne#645). Turning off shows at once either way.
	 */
	toggle(channelId: string, signalId: string): void {
		const userId = Authentication.currentUserId;
		const mine = userId !== null && this.getEntries(channelId, signalId).some((entry) => entry.user.id === userId);
		if (this.confirmedChannels.has(channelId)) {
			if (mine) {
				void this.deactivate(channelId, signalId);
			} else {
				void this.activate(channelId, signalId, this.getEffectivePersonaId(channelId));
			}
			return;
		}
		if (!userId) return;
		const wanted = this.wantedSignals.get(channelId) ?? new Map<string, WantedSignal>();
		wanted.set(signalId, {on: !mine, personaId: mine ? null : this.getEffectivePersonaId(channelId)});
		this.wantedSignals.set(channelId, wanted);
		if (mine) this.removeLocal(channelId, signalId, userId);
		// After a failed request nothing else would ask: the click does, once.
		if (!this.loadingChannels.has(channelId)) void this.fetchChannel(channelId);
	}

	/** Sends the clicks waiting for a chat: against its answer, or as they are when it has none. */
	private sendWanted(channelId: string, answered: boolean): void {
		const wanted = this.wantedSignals.get(channelId);
		if (!wanted) return;
		this.wantedSignals.delete(channelId);
		const userId = Authentication.currentUserId;
		if (!userId) return;
		for (const [signalId, want] of wanted) {
			const on = this.getEntries(channelId, signalId).some((entry) => entry.user.id === userId);
			if (answered && on === want.on) continue;
			if (want.on) {
				void this.activate(channelId, signalId, want.personaId);
			} else {
				void this.deactivate(channelId, signalId);
			}
		}
	}

	private rememberEntries(entries: ReadonlyArray<ChannelSignalEntry>): void {
		if (entries.length === 0) return;
		Users.cacheUsers(entries.map((entry) => entry.user));
		for (const entry of entries) {
			if (entry.subprofile) PersonaStore.recordKnownPersona(entry.subprofile, entry.user.id);
		}
	}

	handleChannelUpdate(event: ChannelSignalUpdateEvent): void {
		this.ensureVersion(event.bar_version);
		this.trackMyChats(event);
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
		// Switching off clears the channel's signals without a CHANNEL_SIGNAL_UPDATE.
		if (!event.enabled && this.myChats?.has(event.channel_id)) {
			const next = new Map(this.myChats);
			next.delete(event.channel_id);
			this.myChats = next;
		}
		if (!event.enabled || !this.entriesByChannel.has(event.channel_id)) {
			this.entriesByChannel.set(event.channel_id, EMPTY_ENTRIES);
		}
	}

	async setDmEnabled(channelId: string, enabled: boolean): Promise<void> {
		try {
			await http.put(ForkEndpoints.CHANNEL_SIGNAL_BAR(channelId), {body: {enabled}});
		} catch (err) {
			logger.error('Error switching the signal bar', err);
			void this.fetchChannel(channelId);
		}
	}

	async removeUser(channelId: string, signalId: string, userId: string): Promise<void> {
		this.removeLocal(channelId, signalId, userId);
		try {
			await http.delete(ForkEndpoints.CHANNEL_SIGNAL_USER(channelId, signalId, userId));
		} catch (err) {
			logger.error("Error turning off someone's signal", err);
			void this.fetchChannel(channelId);
		}
	}

	async fetchGuildSettings(guildId: string): Promise<GuildSignalBarSettings | null> {
		try {
			const res = await http.get<GuildSignalBarSettings>(ForkEndpoints.GUILD_SIGNAL_BAR_CHANNELS(guildId));
			return res.ok && res.body ? res.body : null;
		} catch (err) {
			logger.error('Error fetching signal bar channels', err);
			return null;
		}
	}

	async saveGuildSettings(guildId: string, settings: GuildSignalBarSettings): Promise<GuildSignalBarSettings | null> {
		try {
			const res = await http.put<GuildSignalBarSettings>(ForkEndpoints.GUILD_SIGNAL_BAR_CHANNELS(guildId), {
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
			await http.put(ForkEndpoints.CHANNEL_SIGNAL_ME(channelId, signalId), {
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
			await http.delete(ForkEndpoints.CHANNEL_SIGNAL_ME(channelId, signalId));
		} catch (err) {
			logger.error('Error withdrawing signal', err);
			void this.fetchChannel(channelId);
		}
	}

	async reset(channelId: string, signalId: string): Promise<void> {
		try {
			await http.delete(ForkEndpoints.CHANNEL_SIGNAL(channelId, signalId));
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
				everywhere: signal.everywhere,
			})),
		};
		try {
			const res = await http.put<SignalBarResponse>(ForkEndpoints.INSTANCE_SIGNAL_BAR, {body});
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
