// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import type {
	ChannelPersonaMentionItem,
	ChannelPersonaMentionsResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {useEffect, useRef, useState} from 'react';

interface CacheEntry {
	items: Array<ChannelPersonaMentionItem>;
	fetchedAt: number;
	guildId?: string | null;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes backup TTL (primary invalidation is push-driven via gateway)
const channelPersonaCache = new Map<string, CacheEntry>();

export function clearPersonaMentionCache(channelId?: string): void {
	if (channelId) {
		channelPersonaCache.delete(channelId);
	} else {
		channelPersonaCache.clear();
	}
}

export function invalidatePersonaMentionCache(guildId?: string): void {
	if (!guildId) {
		channelPersonaCache.clear();
		return;
	}
	for (const [channelId, entry] of channelPersonaCache.entries()) {
		if (!entry.guildId || entry.guildId === guildId) {
			channelPersonaCache.delete(channelId);
		}
	}
}

export function calculatePersonaFrecencyScore(
	useCount?: number,
	lastUsedAtMs?: string | number | bigint | null,
	now: number = Date.now(),
): number {
	const safeCount = Math.max(0, useCount || 0);
	const countScore = Math.log10(safeCount + 1) * 20;

	const ms =
		typeof lastUsedAtMs === 'string'
			? Number(lastUsedAtMs)
			: typeof lastUsedAtMs === 'bigint'
				? Number(lastUsedAtMs)
				: (lastUsedAtMs ?? null);
	if (!ms || ms <= 0 || Number.isNaN(ms)) {
		return countScore;
	}

	const ageMs = Math.max(0, now - ms);
	const ageHours = ageMs / (1000 * 60 * 60);

	let recencyBoost = 0;
	if (ageHours < 0.25) {
		recencyBoost = 120;
	} else if (ageHours < 1) {
		recencyBoost = 90;
	} else if (ageHours < 24) {
		recencyBoost = 60;
	} else if (ageHours < 72) {
		recencyBoost = 35;
	} else if (ageHours < 168) {
		recencyBoost = 15;
	} else if (ageHours < 720) {
		recencyBoost = 5;
	}

	return countScore + recencyBoost;
}

export function calculatePersonaMatchScore(
	personaName: string,
	query: string,
	displayTagText?: string | null,
	ownerUsername?: string | null,
	ownerNickname?: string | null,
	ownerGlobalName?: string | null,
): number {
	const q = query.trim().toLowerCase();
	if (!q) return 0;

	const name = personaName.toLowerCase();
	if (name.startsWith(q)) {
		return 1000;
	}
	if (name.includes(` ${q}`) || name.includes(`-${q}`) || name.includes(`_${q}`)) {
		return 800;
	}
	if (name.includes(q)) {
		return 500;
	}
	const sys = (displayTagText ?? '').toLowerCase();
	if (sys.startsWith(q)) {
		return 350;
	}
	if (sys.includes(q)) {
		return 250;
	}
	const user = (ownerUsername ?? '').toLowerCase();
	const nick = (ownerNickname ?? '').toLowerCase();
	const global = (ownerGlobalName ?? '').toLowerCase();
	if (user.startsWith(q) || nick.startsWith(q) || global.startsWith(q)) {
		return 150;
	}
	if (user.includes(q) || nick.includes(q) || global.includes(q)) {
		return 100;
	}
	return -1;
}

export function filterPersonaMentions(
	items: Array<ChannelPersonaMentionItem>,
	query: string,
): Array<ChannelPersonaMentionItem> {
	const normalized = query.trim().toLowerCase();
	const now = Date.now();

	const filtered = normalized
		? items.filter((item) => {
				const match = calculatePersonaMatchScore(
					item.name,
					normalized,
					item.display_tag_text,
					item.owner_username,
					item.owner_nickname,
					item.owner_global_name,
				);
				return match >= 0;
			})
		: [...items];

	filtered.sort((a, b) => {
		if (normalized) {
			const aMatch = calculatePersonaMatchScore(
				a.name,
				normalized,
				a.display_tag_text,
				a.owner_username,
				a.owner_nickname,
				a.owner_global_name,
			);
			const bMatch = calculatePersonaMatchScore(
				b.name,
				normalized,
				b.display_tag_text,
				b.owner_username,
				b.owner_nickname,
				b.owner_global_name,
			);
			if (aMatch !== bMatch) {
				return bMatch - aMatch;
			}
		}
		const aFrecency = calculatePersonaFrecencyScore(a.use_count, a.last_used_at_ms, now);
		const bFrecency = calculatePersonaFrecencyScore(b.use_count, b.last_used_at_ms, now);
		if (Math.abs(bFrecency - aFrecency) > 0.001) {
			return bFrecency - aFrecency;
		}
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});

	return filtered;
}

function mergeIntoCache(channelId: string, newItems: Array<ChannelPersonaMentionItem>, guildId?: string | null): void {
	const existing = channelPersonaCache.get(channelId);
	const itemMap = new Map<string, ChannelPersonaMentionItem>();
	if (existing) {
		for (const item of existing.items) {
			itemMap.set(item.id, item);
		}
	}
	for (const item of newItems) {
		itemMap.set(item.id, item);
	}
	channelPersonaCache.set(channelId, {
		items: Array.from(itemMap.values()),
		fetchedAt: Date.now(),
		guildId: guildId !== undefined ? guildId : existing?.guildId,
	});
}

async function fetchChannelPersonas(
	channelId: string,
	q = '',
	limit = 500,
): Promise<Array<ChannelPersonaMentionItem> | null> {
	try {
		const res = await http.get<ChannelPersonaMentionsResponse>(Endpoints.CHANNEL_PERSONA_MENTIONS(channelId), {
			query: {q, limit},
		});
		if (res.ok && Array.isArray(res.body)) {
			return res.body;
		}
	} catch {
		// Ignore errors during autocomplete search
	}
	return null;
}

export function useAutocompletePersonaSearch({
	triggerType,
	matchedText,
	channelId,
	guildId,
}: {
	triggerType: string | null;
	matchedText: string;
	channelId: string | null | undefined;
	guildId?: string | null | undefined;
}): Array<ChannelPersonaMentionItem> {
	const [results, setResults] = useState<Array<ChannelPersonaMentionItem>>(() => {
		if (triggerType !== 'mention' || !channelId) return [];
		const cached = channelPersonaCache.get(channelId);
		return cached ? filterPersonaMentions(cached.items, matchedText) : [];
	});
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const activeQueryRef = useRef<string>('');

	useEffect(() => {
		if (triggerType !== 'mention' || !channelId) {
			setResults([]);
			activeQueryRef.current = '';
			if (debounceTimerRef.current != null) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
			return;
		}

		const query = matchedText.trim();
		activeQueryRef.current = query;

		const cached = channelPersonaCache.get(channelId);
		const now = Date.now();
		const hasValidCache = cached && now - cached.fetchedAt <= CACHE_TTL_MS;

		// Immediately update results from cache if we have local matches
		if (cached) {
			const localMatches = filterPersonaMentions(cached.items, query);
			if (localMatches.length > 0) {
				setResults(localMatches);
			} else if (!query) {
				setResults(cached.items);
			}
			// If cache is fresh and local matches exist, no network fetch needed
			if (hasValidCache && localMatches.length > 0) {
				if (debounceTimerRef.current != null) {
					clearTimeout(debounceTimerRef.current);
					debounceTimerRef.current = null;
				}
				return;
			}
		}

		if (debounceTimerRef.current != null) {
			clearTimeout(debounceTimerRef.current);
		}

		// Fast debounce: 60ms for search refinement (0ms for empty query prefetch)
		const debounceMs = query ? 60 : 0;

		debounceTimerRef.current = setTimeout(async () => {
			const items = await fetchChannelPersonas(channelId, query, 500);
			// Guard against stale async responses: only update if query hasn't changed
			if (activeQueryRef.current === query && items) {
				mergeIntoCache(channelId, items, guildId);
				setResults(filterPersonaMentions(items, query));
			}
		}, debounceMs);

		return () => {
			if (debounceTimerRef.current != null) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, [triggerType, matchedText, channelId, guildId]);

	return results;
}
