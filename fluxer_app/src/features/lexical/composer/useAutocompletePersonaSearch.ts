// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import type {
	ChannelPersonaMentionItem,
	ChannelPersonaMentionsResponse,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {useEffect, useRef, useState} from 'react';

const PERSONA_FETCH_DEBOUNCE_MS = 150;

export function useAutocompletePersonaSearch({
	triggerType,
	matchedText,
	channelId,
}: {
	triggerType: string | null;
	matchedText: string;
	channelId: string | null | undefined;
}): Array<ChannelPersonaMentionItem> {
	const [results, setResults] = useState<Array<ChannelPersonaMentionItem>>([]);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (triggerType !== 'mention' || !channelId) {
			setResults([]);
			if (debounceTimerRef.current != null) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
			return;
		}

		if (debounceTimerRef.current != null) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(async () => {
			try {
				const res = await http.get<ChannelPersonaMentionsResponse>(Endpoints.CHANNEL_PERSONA_MENTIONS(channelId), {
					query: {q: matchedText.trim()},
				});
				if (res.ok && Array.isArray(res.body)) {
					setResults(res.body);
				}
			} catch {
				// Ignore errors during autocomplete search
			}
		}, PERSONA_FETCH_DEBOUNCE_MS);

		return () => {
			if (debounceTimerRef.current != null) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, [triggerType, matchedText, channelId]);

	return results;
}
