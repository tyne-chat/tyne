// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: 'persona' for personas in from:/mentions: (PersonaSearchFilters.ts).
type SearchSegmentType = 'user' | 'channel' | 'persona';

export interface SearchSegment {
	type: SearchSegmentType;
	filterKey: string;
	id: string;
	displayText: string;
	start: number;
	end: number;
}
