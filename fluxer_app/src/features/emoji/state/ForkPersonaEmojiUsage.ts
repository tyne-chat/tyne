// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: stores per-persona emoji frecency in AppStorage (not raw localStorage) so it survives
// production storage hardening and stays isolated per account scope (tyne-chat/tyne#140, tyne-chat/tyne#947).

import {bumpUsageEntry, type UsageEntry} from '@app/features/emoji/state/UsageFrecency';
import AppStorage from '@app/features/platform/state/PersistentStorage';

const PERSONA_USAGE_STORAGE_KEY = 'fluxer_persona_emoji_usage';

type PersonaUsageMap = Record<string, Record<string, UsageEntry>>;

let cachedMap: PersonaUsageMap = {};
let loaded = false;

AppStorage.subscribe(({key}) => {
	if (key === null || key === PERSONA_USAGE_STORAGE_KEY) {
		loaded = false;
		cachedMap = {};
	}
});

function ensureLoaded(): void {
	if (loaded) return;
	loaded = true;
	const stored = AppStorage.getJSON<PersonaUsageMap>(PERSONA_USAGE_STORAGE_KEY);
	cachedMap = stored && typeof stored === 'object' ? stored : {};
}

export function getPersonaEmojiUsage(personaId: string): Record<string, UsageEntry> | undefined {
	ensureLoaded();
	return cachedMap[personaId];
}

export function trackPersonaEmojiUsage(personaId: string, emojiKey: string, now: number): void {
	ensureLoaded();
	const pMap = cachedMap[personaId] ?? {};
	pMap[emojiKey] = bumpUsageEntry(pMap[emojiKey], now);
	cachedMap[personaId] = pMap;
	AppStorage.setJSON(PERSONA_USAGE_STORAGE_KEY, cachedMap);
}
