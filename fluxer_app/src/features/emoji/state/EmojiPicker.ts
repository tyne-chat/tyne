// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	bumpUsageEntry,
	dedupeBoundedIds,
	EMPTY_USAGE_RANKING,
	isValidUsageKey,
	MAX_TRACKED_USAGE_KEYS,
	mergeWireUsageMaps,
	rankUsageMap,
	sanitizeUsageMap,
	type UsageEntry,
	type UsageRanking,
	usageEntryFromWire,
	usageEntryToWire,
} from '@app/features/emoji/state/UsageFrecency';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import {makeSyncedField} from '@app/features/user/state/SyncedField';
import {EmojiPickerStateSchema} from '@fluxer/schema/src/gen/fluxer/user/preferences/v1/pickers_pb';
import {makeAutoObservable, untracked} from 'mobx';

// Fork imports.

import UnicodeEmojis from '@app/features/expressions/utils/UnicodeEmojis';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';

const logger = new Logger('EmojiPicker');

export const UNICODE_EMOJI_USAGE_KEY_PREFIX = 'unicode:';
export const CUSTOM_EMOJI_USAGE_KEY_PREFIX = 'custom:';

type EmojiUsageKeyInput = Readonly<Pick<FlatEmoji, 'id' | 'guildId' | 'uniqueName'>>;

export function getEmojiUsageKey(emoji: EmojiUsageKeyInput): string {
	if (emoji.id) {
		return `${CUSTOM_EMOJI_USAGE_KEY_PREFIX}${emoji.guildId ?? ''}:${emoji.id}`;
	}
	return `${UNICODE_EMOJI_USAGE_KEY_PREFIX}${emoji.uniqueName}`;
}

export function isEmojiUsageKey(key: string): boolean {
	if (!isValidUsageKey(key)) {
		return false;
	}
	return key.startsWith(UNICODE_EMOJI_USAGE_KEY_PREFIX) || key.startsWith(CUSTOM_EMOJI_USAGE_KEY_PREFIX);
}

const MAX_FRECENT_EMOJIS = 42;
const MAX_FAVORITE_EMOJIS = 500;
const MAX_COLLAPSED_CATEGORIES = 200;
const USAGE_SYNC_DEBOUNCE_MS = 1_500;
const DEFAULT_QUICK_EMOJI_NAMES = ['thumbsup', 'ok_hand', 'tada', 'heart'];

const emojiKeyIndexCache = new WeakMap<ReadonlyArray<FlatEmoji>, ReadonlyMap<string, FlatEmoji>>();

function getEmojiKeyIndex(allEmojis: ReadonlyArray<FlatEmoji>): ReadonlyMap<string, FlatEmoji> {
	const cached = emojiKeyIndexCache.get(allEmojis);
	if (cached) {
		return cached;
	}
	const index = new Map<string, FlatEmoji>();
	for (const emoji of allEmojis) {
		const key = getEmojiUsageKey(emoji);
		if (!index.has(key)) {
			index.set(key, emoji);
		}
	}
	emojiKeyIndexCache.set(allEmojis, index);
	return index;
}

class EmojiPicker {
	emojiUsage: Record<string, UsageEntry> = {};
	favoriteEmojis: Array<string> = [];
	pinnedEmojis: Array<string> = [];
	personaPinnedEmojis: Record<string, Array<string>> = {};
	collapsedCategories: Array<string> = [];
	private _favoriteSet: Set<string> = new Set();
	private _pinnedSet: Set<string> = new Set();
	private _personaPinnedSets: Record<string, Set<string>> = {};
	private _collapsedSet: Set<string> = new Set();
	private ranking: UsageRanking = EMPTY_USAGE_RANKING;
	private rankingDirty = true;
	private rankingVersion = 0;
	private personaUsageMap: Record<string, Record<string, UsageEntry>> = {};
	private personaUsageLoaded = false;
	private pinnedLoaded = false;

	constructor() {
		makeAutoObservable<
			EmojiPicker,
			| '_favoriteSet'
			| '_pinnedSet'
			| '_personaPinnedSets'
			| '_collapsedSet'
			| 'ranking'
			| 'rankingDirty'
			| 'rankingVersion'
			| 'personaUsageMap'
			| 'personaUsageLoaded'
			| 'pinnedLoaded'
		>(
			this,
			{
				_favoriteSet: false,
				_pinnedSet: false,
				_personaPinnedSets: false,
				_collapsedSet: false,
				ranking: false,
				rankingDirty: false,
				rankingVersion: false,
				personaUsageMap: false,
				personaUsageLoaded: false,
				pinnedLoaded: false,
			},
			{autoBind: true},
		);
		initializeStore(this, () => this.initPersistence());
	}

	private async initPersistence(): Promise<void> {
		await makeSyncedField(this, {
			field: 'emojiPicker',
			schema: EmojiPickerStateSchema,
			persist: ['emojiUsage', 'favoriteEmojis', 'collapsedCategories'],
			debounceMs: USAGE_SYNC_DEBOUNCE_MS,
			toMessage: (s) => ({
				usage: Object.fromEntries(Object.entries(s.emojiUsage).map(([key, entry]) => [key, usageEntryToWire(entry)])),
				favoriteEmojiIds: [...s.favoriteEmojis],
				collapsedCategoryIds: [...s.collapsedCategories],
			}),
			applyMessage: (s, m) => {
				const now = Date.now();
				const usage: Record<string, UsageEntry> = {};
				for (const [key, stat] of Object.entries(m.usage)) {
					if (!isEmojiUsageKey(key)) continue;
					usage[key] = usageEntryFromWire(stat);
				}
				s.emojiUsage = sanitizeUsageMap(usage, now);
				s.favoriteEmojis = dedupeBoundedIds(m.favoriteEmojiIds, MAX_FAVORITE_EMOJIS);
				s.collapsedCategories = dedupeBoundedIds(m.collapsedCategoryIds, MAX_COLLAPSED_CATEGORIES);
				s._favoriteSet = new Set(s.favoriteEmojis);
				s._collapsedSet = new Set(s.collapsedCategories);
				s.rankingDirty = true;
			},
			mergeRemote: (local, incoming) => ({
				usage: mergeWireUsageMaps(local.usage, incoming.usage, Date.now()),
				favoriteEmojiIds: [...incoming.favoriteEmojiIds],
				collapsedCategoryIds: [...incoming.collapsedCategoryIds],
			}),
		});
		this._favoriteSet = new Set(this.favoriteEmojis);
		this._collapsedSet = new Set(this.collapsedCategories);
		this.rankingDirty = true;
		ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
	}

	getRanking(): UsageRanking {
		if (this.rankingDirty) {
			this.rankingVersion += 1;
			this.ranking = untracked(() => rankUsageMap(this.emojiUsage, Date.now(), this.rankingVersion));
			this.rankingDirty = false;
		}
		return this.ranking;
	}

	private loadPersonaUsage(): void {
		if (this.personaUsageLoaded || typeof window === 'undefined') return;
		this.personaUsageLoaded = true;
		try {
			const raw = window.localStorage.getItem('fluxer_persona_emoji_usage');
			if (raw) {
				this.personaUsageMap = JSON.parse(raw);
			}
		} catch {}
	}

	private savePersonaUsage(): void {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem('fluxer_persona_emoji_usage', JSON.stringify(this.personaUsageMap));
		} catch {}
	}

	/** @internal */
	resetPinnedEmojis(): void {
		this.pinnedEmojis = [];
		this._pinnedSet = new Set();
		this.personaPinnedEmojis = {};
		this._personaPinnedSets = {};
		this.pinnedLoaded = false;
	}

	private loadPinnedEmojis(): void {
		if (this.pinnedLoaded || typeof window === 'undefined') return;
		this.pinnedLoaded = true;
		this.pinnedEmojis = [];
		this._pinnedSet = new Set();
		this.personaPinnedEmojis = {};
		this._personaPinnedSets = {};
		try {
			const globalRaw = window.localStorage.getItem('fluxer_pinned_emojis');
			if (globalRaw) {
				const parsed = JSON.parse(globalRaw);
				if (Array.isArray(parsed)) {
					this.pinnedEmojis = parsed.filter(isEmojiUsageKey);
					this._pinnedSet = new Set(this.pinnedEmojis);
				}
			}
		} catch {}
		try {
			const personaRaw = window.localStorage.getItem('fluxer_persona_pinned_emojis');
			if (personaRaw) {
				const parsed = JSON.parse(personaRaw);
				if (parsed && typeof parsed === 'object') {
					for (const [pId, keys] of Object.entries(parsed)) {
						if (Array.isArray(keys)) {
							const validKeys = keys.filter(isEmojiUsageKey);
							this.personaPinnedEmojis[pId] = validKeys;
							this._personaPinnedSets[pId] = new Set(validKeys);
						}
					}
				}
			}
		} catch {}
	}

	private savePinnedEmojis(): void {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem('fluxer_pinned_emojis', JSON.stringify(this.pinnedEmojis));
		} catch {}
		try {
			window.localStorage.setItem('fluxer_persona_pinned_emojis', JSON.stringify(this.personaPinnedEmojis));
		} catch {}
	}

	getGloballyPinnedEmojiKeys(): ReadonlyArray<string> {
		this.loadPinnedEmojis();
		return this.pinnedEmojis;
	}

	getPersonaPinnedEmojiKeys(personaId: string): ReadonlyArray<string> {
		this.loadPinnedEmojis();
		return this.personaPinnedEmojis[personaId] ?? [];
	}

	getAllEffectivePinnedEmojiKeys(personaId?: string | null): ReadonlyArray<string> {
		this.loadPinnedEmojis();
		const result: Array<string> = [];
		const seen = new Set<string>();
		for (const key of this.pinnedEmojis) {
			if (!seen.has(key)) {
				seen.add(key);
				result.push(key);
			}
		}
		if (personaId) {
			const personaPins = this.personaPinnedEmojis[personaId];
			if (personaPins) {
				for (const key of personaPins) {
					if (!seen.has(key)) {
						seen.add(key);
						result.push(key);
					}
				}
			}
		}
		return result;
	}

	isGloballyPinned(emoji: FlatEmoji | string): boolean {
		this.loadPinnedEmojis();
		void this.pinnedEmojis.length;
		const key = typeof emoji === 'string' ? emoji : getEmojiUsageKey(emoji);
		return this._pinnedSet.has(key);
	}

	isPersonaPinned(emoji: FlatEmoji | string, personaId: string): boolean {
		this.loadPinnedEmojis();
		void this.personaPinnedEmojis[personaId]?.length;
		const key = typeof emoji === 'string' ? emoji : getEmojiUsageKey(emoji);
		return this._personaPinnedSets[personaId]?.has(key) ?? false;
	}

	isPinned(emoji: FlatEmoji | string, personaId?: string | null): boolean {
		if (personaId && this.isPersonaPinned(emoji, personaId)) {
			return true;
		}
		return this.isGloballyPinned(emoji);
	}

	togglePin(emoji: FlatEmoji | string, personaId?: string | null): void {
		const key = typeof emoji === 'string' ? emoji : getEmojiUsageKey(emoji);
		if (!isEmojiUsageKey(key)) {
			logger.warn(`Ignored pin toggle for invalid emoji key: ${key}`);
			return;
		}
		this.loadPinnedEmojis();
		if (personaId) {
			if (!this.personaPinnedEmojis[personaId]) {
				this.personaPinnedEmojis[personaId] = [];
			}
			const personaList = this.personaPinnedEmojis[personaId];
			let personaSet = this._personaPinnedSets[personaId];
			if (!personaSet) {
				personaSet = new Set();
				this._personaPinnedSets[personaId] = personaSet;
			}
			if (personaSet.has(key)) {
				personaSet.delete(key);
				const index = personaList.indexOf(key);
				if (index > -1) personaList.splice(index, 1);
			} else {
				personaSet.add(key);
				personaList.push(key);
			}
		} else {
			if (this._pinnedSet.has(key)) {
				this._pinnedSet.delete(key);
				const index = this.pinnedEmojis.indexOf(key);
				if (index > -1) this.pinnedEmojis.splice(index, 1);
			} else {
				this._pinnedSet.add(key);
				this.pinnedEmojis.push(key);
			}
		}
		this.savePinnedEmojis();
		ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
	}

	pinEmoji(emoji: FlatEmoji | string, personaId?: string | null): void {
		const key = typeof emoji === 'string' ? emoji : getEmojiUsageKey(emoji);
		if (!isEmojiUsageKey(key)) return;
		this.loadPinnedEmojis();
		if (personaId) {
			if (!this.personaPinnedEmojis[personaId]) {
				this.personaPinnedEmojis[personaId] = [];
			}
			const personaList = this.personaPinnedEmojis[personaId];
			let personaSet = this._personaPinnedSets[personaId];
			if (!personaSet) {
				personaSet = new Set();
				this._personaPinnedSets[personaId] = personaSet;
			}
			if (!personaSet.has(key)) {
				personaSet.add(key);
				personaList.push(key);
				this.savePinnedEmojis();
				ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
			}
		} else {
			if (!this._pinnedSet.has(key)) {
				this._pinnedSet.add(key);
				this.pinnedEmojis.push(key);
				this.savePinnedEmojis();
				ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
			}
		}
	}

	unpinEmoji(emoji: FlatEmoji | string, personaId?: string | null): void {
		const key = typeof emoji === 'string' ? emoji : getEmojiUsageKey(emoji);
		if (!isEmojiUsageKey(key)) return;
		this.loadPinnedEmojis();
		if (personaId) {
			const personaList = this.personaPinnedEmojis[personaId];
			const personaSet = this._personaPinnedSets[personaId];
			if (personaSet?.has(key)) {
				personaSet.delete(key);
				const index = personaList ? personaList.indexOf(key) : -1;
				if (index > -1 && personaList) personaList.splice(index, 1);
				this.savePinnedEmojis();
				ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
			}
		} else {
			if (this._pinnedSet.has(key)) {
				this._pinnedSet.delete(key);
				const index = this.pinnedEmojis.indexOf(key);
				if (index > -1) this.pinnedEmojis.splice(index, 1);
				this.savePinnedEmojis();
				ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
			}
		}
	}

	getPersonaUsage(personaId: string): Record<string, UsageEntry> | undefined {
		this.loadPersonaUsage();
		return this.personaUsageMap[personaId];
	}

	trackEmojiUsage(emojiKey: string, personaId?: string | null): void {
		if (!isEmojiUsageKey(emojiKey)) {
			logger.warn(`Ignored usage tracking for invalid emoji key: ${emojiKey}`);
			return;
		}
		const now = Date.now();
		this.emojiUsage[emojiKey] = bumpUsageEntry(this.emojiUsage[emojiKey], now);
		if (Object.keys(this.emojiUsage).length > MAX_TRACKED_USAGE_KEYS) {
			this.emojiUsage = sanitizeUsageMap(this.emojiUsage, now);
		}
		this.rankingDirty = true;

		if (personaId) {
			this.loadPersonaUsage();
			const pMap = this.personaUsageMap[personaId] ?? {};
			pMap[emojiKey] = bumpUsageEntry(pMap[emojiKey], now);
			this.personaUsageMap[personaId] = pMap;
			this.savePersonaUsage();
		}
	}

	trackEmoji(emoji: FlatEmoji, personaId?: string | null): void {
		this.trackEmojiUsage(getEmojiUsageKey(emoji), personaId);
	}

	toggleFavorite(emojiKey: string): void {
		if (this._favoriteSet.has(emojiKey)) {
			this._favoriteSet.delete(emojiKey);
			const index = this.favoriteEmojis.indexOf(emojiKey);
			if (index > -1) this.favoriteEmojis.splice(index, 1);
		} else {
			if (this.favoriteEmojis.length >= MAX_FAVORITE_EMOJIS) {
				logger.warn(`Favorite emoji limit of ${MAX_FAVORITE_EMOJIS} reached; ignoring ${emojiKey}`);
				return;
			}
			this._favoriteSet.add(emojiKey);
			this.favoriteEmojis.push(emojiKey);
		}
		ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
	}

	reorderFavorite(sourceKey: string, targetKey: string, position: 'before' | 'after' = 'before'): void {
		const fromIndex = this.favoriteEmojis.indexOf(sourceKey);
		const targetIndex = this.favoriteEmojis.indexOf(targetKey);
		if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return;

		this.favoriteEmojis.splice(fromIndex, 1);
		let newTargetIndex = this.favoriteEmojis.indexOf(targetKey);
		if (position === 'after') {
			newTargetIndex += 1;
		}
		this.favoriteEmojis.splice(newTargetIndex, 0, sourceKey);
		ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
	}

	toggleCategory(category: string): void {
		if (this._collapsedSet.has(category)) {
			this._collapsedSet.delete(category);
			const index = this.collapsedCategories.indexOf(category);
			if (index > -1) this.collapsedCategories.splice(index, 1);
		} else {
			if (this.collapsedCategories.length >= MAX_COLLAPSED_CATEGORIES) {
				return;
			}
			this._collapsedSet.add(category);
			this.collapsedCategories.push(category);
		}
		ComponentBus.dispatch('EMOJI_PICKER_RERENDER');
	}

	isFavorite(emoji: FlatEmoji): boolean {
		void this.favoriteEmojis.length;
		return this._favoriteSet.has(getEmojiUsageKey(emoji));
	}

	isCategoryCollapsed(categoryId: string): boolean {
		void this.collapsedCategories.length;
		return this._collapsedSet.has(categoryId);
	}

	getFrecentEmojiKeys(
		limitOrPersonaId: number | string | null = MAX_FRECENT_EMOJIS,
		ranking: UsageRanking = this.getRanking(),
		personaId?: string | null,
	): ReadonlyArray<string> {
		this.loadPinnedEmojis();
		let limit = MAX_FRECENT_EMOJIS;
		let effectivePersonaId = personaId;
		if (typeof limitOrPersonaId === 'string') {
			effectivePersonaId = limitOrPersonaId;
		} else if (typeof limitOrPersonaId === 'number') {
			limit = limitOrPersonaId;
		}
		const result: Array<string> = [];
		const seen = new Set<string>();

		for (const key of this.pinnedEmojis) {
			if (!seen.has(key)) {
				seen.add(key);
				result.push(key);
			}
		}

		if (effectivePersonaId) {
			const personaPins = this.personaPinnedEmojis[effectivePersonaId];
			if (personaPins) {
				for (const key of personaPins) {
					if (!seen.has(key)) {
						seen.add(key);
						result.push(key);
					}
				}
			}
		}

		if (effectivePersonaId) {
			const persona = PersonaStore.personas.find((p) => p.id === effectivePersonaId);
			if (persona) {
				const sigs = persona.signature_emojis ?? persona.signatureEmojis ?? [];
				for (const sig of sigs) {
					let key: string | null = null;
					if (sig.id) {
						key = `${CUSTOM_EMOJI_USAGE_KEY_PREFIX}:${sig.id}`;
					} else if (sig.name) {
						const surrogate = UnicodeEmojis.normalizeEmojiNameToSurrogate(sig.name);
						const uniqueName = UnicodeEmojis.getSurrogateName(surrogate) || sig.name;
						key = `${UNICODE_EMOJI_USAGE_KEY_PREFIX}${uniqueName}`;
					}
					if (key && !seen.has(key)) {
						seen.add(key);
						result.push(key);
					}
				}
			}

			const personaUsage = this.getPersonaUsage(effectivePersonaId);
			if (personaUsage) {
				const rankedPersonaKeys = rankUsageMap(personaUsage, Date.now(), 0).rankedKeys;
				for (const key of rankedPersonaKeys) {
					if (!seen.has(key)) {
						seen.add(key);
						result.push(key);
					}
				}
			}
		}

		for (const key of ranking.rankedKeys) {
			if (!seen.has(key)) {
				seen.add(key);
				result.push(key);
			}
		}

		if (limit > 0 && result.length > limit) {
			return result.slice(0, limit);
		}
		return result;
	}

	getFrecentEmojis(
		allEmojis: ReadonlyArray<FlatEmoji>,
		limit: number = MAX_FRECENT_EMOJIS,
		ranking: UsageRanking = this.getRanking(),
		personaId?: string | null,
	): Array<FlatEmoji> {
		this.loadPinnedEmojis();
		const index = getEmojiKeyIndex(allEmojis);
		const result: Array<FlatEmoji> = [];
		const seenKeys = new Set<string>();

		const addEmoji = (emoji: FlatEmoji | undefined, key?: string) => {
			if (!emoji) return;
			const usageKey = key ?? getEmojiUsageKey(emoji);
			if (seenKeys.has(usageKey)) return;
			seenKeys.add(usageKey);
			result.push(emoji);
		};

		const addEmojiByKey = (key: string) => {
			if (seenKeys.has(key)) return;
			let emoji = index.get(key);
			if (!emoji) {
				if (key.startsWith(CUSTOM_EMOJI_USAGE_KEY_PREFIX)) {
					const lastSeparatorIndex = key.lastIndexOf(':');
					const emojiId = key.slice(lastSeparatorIndex + 1);
					emoji = allEmojis.find((e) => e.id === emojiId);
				} else if (key.startsWith(UNICODE_EMOJI_USAGE_KEY_PREFIX)) {
					const name = key.slice(UNICODE_EMOJI_USAGE_KEY_PREFIX.length);
					emoji = allEmojis.find((e) => !e.id && (e.uniqueName === name || e.name === name));
				}
			}
			if (emoji) addEmoji(emoji, key);
		};

		// 1. Globally pinned emojis
		for (const key of this.pinnedEmojis) {
			addEmojiByKey(key);
			if (limit > 0 && result.length >= limit) return result;
		}

		// 2. Active persona pinned emojis
		if (personaId) {
			const personaPins = this.personaPinnedEmojis[personaId];
			if (personaPins) {
				for (const key of personaPins) {
					addEmojiByKey(key);
					if (limit > 0 && result.length >= limit) return result;
				}
			}
		}

		// 3. Persona signature emojis and persona usage
		if (personaId) {
			const persona = PersonaStore.personas.find((p) => p.id === personaId);
			if (persona) {
				const sigs = persona.signature_emojis ?? persona.signatureEmojis ?? [];
				for (const sig of sigs) {
					if (sig.id) {
						const match = allEmojis.find((e) => e.id === sig.id);
						if (match) addEmoji(match);
					} else if (sig.name) {
						const surrogate = UnicodeEmojis.normalizeEmojiNameToSurrogate(sig.name);
						const uniqueName = UnicodeEmojis.getSurrogateName(surrogate) || sig.name;
						const match = allEmojis.find(
							(e) =>
								!e.id &&
								(e.uniqueName === uniqueName ||
									e.uniqueName === sig.name ||
									e.name === sig.name ||
									e.name === surrogate),
						);
						if (match) addEmoji(match);
					}
					if (limit > 0 && result.length >= limit) return result;
				}
			}

			const personaUsage = this.getPersonaUsage(personaId);
			if (personaUsage) {
				const rankedPersonaKeys = rankUsageMap(personaUsage, Date.now(), 0).rankedKeys;
				for (const key of rankedPersonaKeys) {
					const emoji = index.get(key);
					if (emoji) addEmoji(emoji, key);
					if (limit > 0 && result.length >= limit) return result;
				}
			}
		}

		// 4. Global frecents
		for (const key of ranking.rankedKeys) {
			const emoji = index.get(key);
			if (!emoji) continue;
			addEmoji(emoji, key);
			if (limit > 0 && result.length >= limit) break;
		}
		return result;
	}

	getFavoriteEmojis(allEmojis: ReadonlyArray<FlatEmoji>): Array<FlatEmoji> {
		const emojiByKey = new Map<string, FlatEmoji>();
		for (const emoji of allEmojis) {
			const key = getEmojiUsageKey(emoji);
			if (this._favoriteSet.has(key)) {
				emojiByKey.set(key, emoji);
			}
		}
		const favorites: Array<FlatEmoji> = [];
		for (const key of this.favoriteEmojis) {
			const emoji = emojiByKey.get(key);
			if (emoji) {
				favorites.push(emoji);
			}
		}
		return favorites;
	}

	getFrecencyScoreForEmoji(emoji: FlatEmoji): number {
		return this.getRanking().scoreByKey.get(getEmojiUsageKey(emoji)) ?? 0;
	}

	getDefaultQuickEmojiNames(count: number): Array<string> {
		return DEFAULT_QUICK_EMOJI_NAMES.slice(0, count);
	}
}

export default new EmojiPicker();
