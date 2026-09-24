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
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const channelPersonaCache = new Map<string, CacheEntry>();

export function clearPersonaMentionCache(channelId?: string): void {
	if (channelId) {
		channelPersonaCache.delete(channelId);
	} else {
		channelPersonaCache.clear();
	}
}

export function filterPersonaMentions(
	items: Array<ChannelPersonaMentionItem>,
	query: string,
): Array<ChannelPersonaMentionItem> {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return items;
	return items.filter((item) => {
		const nameMatch = item.name.toLowerCase().includes(normalized);
		const systemMatch = item.system_name?.toLowerCase().includes(normalized);
		const ownerUserMatch = item.owner_username.toLowerCase().includes(normalized);
		const ownerNickMatch = item.owner_nickname?.toLowerCase().includes(normalized);
		const ownerGlobalMatch = item.owner_global_name?.toLowerCase().includes(normalized);
		return (
			nameMatch ||
			Boolean(systemMatch) ||
			Boolean(ownerUserMatch) ||
			Boolean(ownerNickMatch) ||
			Boolean(ownerGlobalMatch)
		);
	});
}

function mergeIntoCache(channelId: string, newItems: Array<ChannelPersonaMentionItem>): void {
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
}: {
	triggerType: string | null;
	matchedText: string;
	channelId: string | null | undefined;
}): Array<ChannelPersonaMentionItem> {
	const [results, setResults] = useState<Array<ChannelPersonaMentionItem>>(() => {
		if (triggerType !== 'mention' || !channelId) return [];
		const cached = channelPersonaCache.get(channelId);
		return cached ? filterPersonaMentions(cached.items, matchedText) : [];
	});
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const activeQueryRef = useRef<string>('');

	// Prefetch all channel personas when channelId changes or mounts
	useEffect(() => {
		if (!channelId) return;
		const cached = channelPersonaCache.get(channelId);
		const now = Date.now();
		if (!cached || now - cached.fetchedAt > CACHE_TTL_MS) {
			void fetchChannelPersonas(channelId, '', 500).then((items) => {
				if (items) {
					mergeIntoCache(channelId, items);
					const currentQuery = activeQueryRef.current;
					if (currentQuery) {
						const filtered = filterPersonaMentions(items, currentQuery);
						if (filtered.length > 0) {
							setResults(filtered);
						}
					}
				}
			});
		}
	}, [channelId]);

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

		// Fast debounce: 60ms for search refinement
		const debounceMs = 60;

		debounceTimerRef.current = setTimeout(async () => {
			const items = await fetchChannelPersonas(channelId, query, 500);
			// Guard against stale async responses: only update if query hasn't changed
			if (activeQueryRef.current === query && items) {
				mergeIntoCache(channelId, items);
				setResults(items);
			}
		}, debounceMs);

		return () => {
			if (debounceTimerRef.current != null) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, [triggerType, matchedText, channelId]);

	return results;
}
