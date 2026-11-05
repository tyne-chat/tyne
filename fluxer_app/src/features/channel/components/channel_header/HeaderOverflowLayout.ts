// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: what a narrow channel header gives up, and in which order (tyne-chat/tyne#233). Pure
// functions, so the decision can be tested without a layout; HeaderOverflow.tsx measures the header
// and applies the result.
//
// As the header narrows, it gives way in this order, one level at a time:
//   1. information that is not an action hides: the channel's topic (once it has less than
//      TOPIC_MIN_REM), a call's screen-share info and its connection status;
//   2. the search box narrows from 15.25 to 9 rem;
//   3. the search box becomes a magnifier;
//   4. a long name shortens, down to NAME_FLOOR_REM;
//   5. actions move into the "More options" menu one at a time, in their fold order;
// and the name goes below its floor only when nothing is left to fold.

export const NAME_COMFORT_REM = 20;
export const NAME_FLOOR_REM = 10;
export const SEARCH_FULL_REM = 15.25;
export const SEARCH_NARROW_REM = 9;
export const TOPIC_MIN_REM = 6;
// A header that gained room keeps its layout until the room exceeds what it needs by this much, so
// that it does not flip back and forth while a window is resized across a step.
export const UNFOLD_BAND_REM = 1;

export const LEVEL_HIDE_INFO = 1;
export const LEVEL_SEARCH_NARROW = 2;
export const LEVEL_SEARCH_ICON = 3;
export const LEVEL_NAME_FLOOR = 4;
const LEVEL_FIRST_FOLD = 5;

export type HeaderItemKind = 'action' | 'search' | 'info';

export interface HeaderItemRule {
	readonly id: string;
	readonly pattern: RegExp;
	readonly kind: HeaderItemKind;
	// Lower folds first.
	readonly foldOrder: number;
}

// Matched against the data-flx attribute of an item in the action row (or of the first element in
// it that has one). An item that matches none folds in the middle of the order, under its own label,
// so a button upstream adds later still fits.
export const HEADER_ITEM_RULES: ReadonlyArray<HeaderItemRule> = [
	{
		id: 'supplement',
		pattern: /voice-call-header-supplement|stream-focus-header-info-wrapper/,
		kind: 'info',
		foldOrder: 0,
	},
	{id: 'connection-status', pattern: /connection-status-container/, kind: 'info', foldOrder: 0},
	{id: 'follow', pattern: /channel-follow-button/, kind: 'action', foldOrder: 1},
	{id: 'developer-tools', pattern: /staff-tools-button/, kind: 'action', foldOrder: 2},
	{id: 'stats', pattern: /stats-(desktop|mobile)/, kind: 'action', foldOrder: 2.5},
	{id: 'favorite', pattern: /toggle-favorite/, kind: 'action', foldOrder: 3},
	{id: 'notifications', pattern: /notification-settings-button/, kind: 'action', foldOrder: 4},
	{id: 'group', pattern: /open-create-group-dm|open-add-friends-to-group/, kind: 'action', foldOrder: 5},
	{id: 'threads', pattern: /threads-button/, kind: 'action', foldOrder: 6},
	{id: 'pins', pattern: /channel-pins-button/, kind: 'action', foldOrder: 7},
	{id: 'inbox', pattern: /inbox-button/, kind: 'action', foldOrder: 8},
	{id: 'members', pattern: /toggle-members/, kind: 'action', foldOrder: 9},
	{id: 'voice-call', pattern: /voice-call-button/, kind: 'action', foldOrder: 10},
	{id: 'video-call', pattern: /video-call-button/, kind: 'action', foldOrder: 10.5},
	{id: 'search', pattern: /message-search-focus-wrapper/, kind: 'search', foldOrder: 11},
	{id: 'updater', pattern: /updater-icon/, kind: 'action', foldOrder: 12},
];

export const UNKNOWN_ITEM_FOLD_ORDER = 5.5;

export function findHeaderItemRule(flx: string | null): HeaderItemRule | null {
	if (flx == null) return null;
	return HEADER_ITEM_RULES.find((rule) => rule.pattern.test(flx)) ?? null;
}

export interface HeaderLayoutItem {
	readonly key: string;
	readonly kind: HeaderItemKind;
	// Width at full size. For the search box, the width of its magnifier; the box's own widths come
	// from HeaderLayoutInput.search.
	readonly width: number;
	readonly foldOrder: number;
	// Items in the title (the Follow button) take room from the name, not from the action row.
	readonly inTitle?: boolean;
}

export interface HeaderLayoutInput {
	// What the grid has for both columns: the header's content width minus the gap between them.
	readonly available: number;
	// The title side's width with the name at min(its length, NAME_COMFORT_REM) and at
	// min(its length, NAME_FLOOR_REM), title items included.
	readonly leftComfort: number;
	readonly leftFloor: number;
	// The room the topic needs to be worth showing, its separator included; 0 without a topic. It is
	// not part of leftComfort, since the topic shrinks by itself.
	readonly topic: number;
	readonly gap: number;
	readonly moreWidth: number;
	readonly search: {readonly full: number; readonly narrow: number} | null;
	// In the order they appear.
	readonly items: ReadonlyArray<HeaderLayoutItem>;
}

export interface HeaderLayout {
	readonly level: number;
	readonly searchMode: 'full' | 'narrow' | 'icon';
	readonly hideInfo: boolean;
	readonly folded: ReadonlySet<string>;
}

// Folding candidates in the order they fold: by fold order, then from the end of the row.
export function foldSequence(items: ReadonlyArray<HeaderLayoutItem>): Array<HeaderLayoutItem> {
	return items
		.map((item, index) => ({item, index}))
		.filter(({item}) => item.kind !== 'info')
		.sort((a, b) => a.item.foldOrder - b.item.foldOrder || b.index - a.index)
		.map(({item}) => item);
}

export function maxLevel(input: HeaderLayoutInput): number {
	return LEVEL_FIRST_FOLD - 1 + foldSequence(input.items).length;
}

export function layoutAtLevel(input: HeaderLayoutInput, level: number): HeaderLayout {
	const sequence = foldSequence(input.items);
	const folded = new Set(sequence.slice(0, Math.max(0, level - LEVEL_FIRST_FOLD + 1)).map((item) => item.key));
	let searchMode: HeaderLayout['searchMode'] = 'full';
	if (level >= LEVEL_SEARCH_ICON) searchMode = 'icon';
	else if (level >= LEVEL_SEARCH_NARROW) searchMode = 'narrow';
	return {level, searchMode, hideInfo: level >= LEVEL_HIDE_INFO, folded};
}

// The widths the action row and the title side need at a level.
export function widthsAtLevel(input: HeaderLayoutInput, level: number): {row: number; left: number} {
	const layout = layoutAtLevel(input, level);
	let left = level >= LEVEL_NAME_FLOOR ? input.leftFloor : input.leftComfort;
	if (!layout.hideInfo) left += input.topic;
	let row = 0;
	let count = 0;
	for (const item of input.items) {
		if (item.kind === 'info' && layout.hideInfo) continue;
		if (layout.folded.has(item.key)) {
			if (item.inTitle) left -= item.width;
			continue;
		}
		if (item.inTitle) continue;
		let width = item.width;
		if (item.kind === 'search' && input.search != null) {
			if (layout.searchMode === 'full') width = input.search.full;
			else if (layout.searchMode === 'narrow') width = input.search.narrow;
		}
		row += width;
		count += 1;
	}
	if (layout.folded.size > 0) {
		row += input.moreWidth;
		count += 1;
	}
	row += input.gap * Math.max(0, count - 1);
	return {row, left};
}

export function fitsAtLevel(input: HeaderLayoutInput, level: number): boolean {
	const {row, left} = widthsAtLevel(input, level);
	return row <= input.available - left + 0.5;
}

// The first level at which everything fits. When nothing fits, the level that needs the least room,
// the earliest of equals: folding a header's only action into the menu would gain nothing.
export function fittingLevel(input: HeaderLayoutInput): number {
	const last = maxLevel(input);
	let best = 0;
	let bestWidth = Number.POSITIVE_INFINITY;
	for (let level = 0; level <= last; level++) {
		if (fitsAtLevel(input, level)) return level;
		const {row, left} = widthsAtLevel(input, level);
		if (row + left < bestWidth - 0.5) {
			best = level;
			bestWidth = row + left;
		}
	}
	return best;
}

// Narrowing gives way at once; widening waits until the room exceeds the need by `band`.
export function nextLevel(input: HeaderLayoutInput, current: number | null, band: number): number {
	const target = fittingLevel(input);
	if (current == null || target >= current) return target;
	const relaxed = fittingLevel({...input, available: input.available - band});
	return relaxed < current ? relaxed : current;
}
