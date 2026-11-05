// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	findHeaderItemRule,
	fittingLevel,
	foldSequence,
	type HeaderLayoutInput,
	type HeaderLayoutItem,
	LEVEL_HIDE_INFO,
	LEVEL_NAME_FLOOR,
	LEVEL_SEARCH_ICON,
	LEVEL_SEARCH_NARROW,
	layoutAtLevel,
	maxLevel,
	nextLevel,
	widthsAtLevel,
} from '@app/features/channel/components/channel_header/HeaderOverflowLayout';
import {describe, expect, it} from 'vitest';

// Sizes at 100 % zoom: icons 32 px with 8 px gaps, the search box 244 px, 144 px narrowed.
const icon = (key: string, foldOrder: number): HeaderLayoutItem => ({key, kind: 'action', width: 32, foldOrder});

const ROW: Array<HeaderLayoutItem> = [
	icon('bell', 4),
	icon('threads', 6),
	icon('pins', 7),
	icon('favorite', 3),
	icon('members', 9),
	{key: 'search', kind: 'search', width: 32, foldOrder: 11},
	icon('developer-tools', 2),
	icon('inbox', 8),
];

// The verification account's #general on chat-dev: a 55 px name, title side 115 px with the
// sidebar toggle; a long name ("tyne-technical-support-header-test") is 262 px.
const input = (available: number, overrides: Partial<HeaderLayoutInput> = {}): HeaderLayoutInput => ({
	available,
	leftComfort: 338,
	leftFloor: 236,
	topic: 0,
	gap: 8,
	moreWidth: 32,
	search: {full: 244, narrow: 144},
	items: ROW,
	...overrides,
});

describe('HeaderOverflowLayout', () => {
	it('recognises the header items by their data-flx', () => {
		const id = (flx: string | null) => findHeaderItemRule(flx)?.id ?? null;
		expect(id('channel.channel-header-components.channel-notification-settings-button.channel-header-icon.click')).toBe(
			'notifications',
		);
		expect(id('threads.thread-notification-settings-button.channel-header-icon')).toBe('notifications');
		expect(id('threads.threads-button.channel-header-icon')).toBe('threads');
		expect(id('channel.channel-header-components.channel-pins-button.icon-button-wrapper--2')).toBe('pins');
		expect(id('channel.channel-header.icon-button.toggle-favorite')).toBe('favorite');
		expect(id('voice.voice-call-view.voice-call-view-inner.channel-header-icon.toggle-favorite')).toBe('favorite');
		expect(id('channel.channel-header.channel-header-icon.toggle-members')).toBe('members');
		expect(id('channel.channel-header.message-search-focus-wrapper')).toBe('search');
		expect(id('channel.channel-header.staff-tools-button')).toBe('developer-tools');
		expect(id('channel.channel-header.inbox-button')).toBe('inbox');
		expect(id('channel.channel-header-components.call-buttons.voice-call-button.channel-header-icon.click')).toBe(
			'voice-call',
		);
		expect(id('channel.channel-header-components.call-buttons.video-call-button.channel-header-icon.click')).toBe(
			'video-call',
		);
		expect(id('channel.channel-header.channel-header-icon.open-create-group-dm')).toBe('group');
		expect(id('channel.channel-header-components.updater-icon.button.click')).toBe('updater');
		expect(id('channel.channel-header-components.channel-follow-button.button.open-follow-modal')).toBe('follow');
		expect(id('channel.channel-header.voice-call-header-supplement')).toBe('supplement');
		expect(id('voice.voice-call-view.voice-call-view-inner.connection-status-container')).toBe('connection-status');
		expect(id('voice.voice-call-view.voice-call-view-inner.stats-desktop')).toBe('stats');
		expect(id('channel.channel-header.something-upstream-adds-later')).toBeNull();
		expect(id(null)).toBeNull();
	});

	it('folds by fold order, and the later of two equal ones first', () => {
		const order = foldSequence([...ROW, icon('unknown-a', 5.5), icon('unknown-b', 5.5)]).map((item) => item.key);
		expect(order).toEqual([
			'developer-tools',
			'favorite',
			'bell',
			'unknown-b',
			'unknown-a',
			'threads',
			'pins',
			'inbox',
			'members',
			'search',
		]);
	});

	it('changes nothing when everything fits', () => {
		// Row: 7 icons + the full search box + 7 gaps = 524; title 338.
		expect(fittingLevel(input(524 + 338))).toBe(0);
	});

	it('hides the topic first when it alone does not fit', () => {
		const topic = 22 + 96;
		expect(fittingLevel(input(524 + 338 + topic, {topic}))).toBe(0);
		expect(fittingLevel(input(524 + 338 + topic - 1, {topic}))).toBe(LEVEL_HIDE_INFO);
		expect(layoutAtLevel(input(0), LEVEL_HIDE_INFO).hideInfo).toBe(true);
	});

	it('narrows the search box, then makes it a magnifier, before the name shortens', () => {
		expect(fittingLevel(input(524 + 338 - 1))).toBe(LEVEL_SEARCH_NARROW);
		expect(layoutAtLevel(input(0), LEVEL_SEARCH_NARROW).searchMode).toBe('narrow');
		expect(fittingLevel(input(424 + 338 - 1))).toBe(LEVEL_SEARCH_ICON);
		expect(layoutAtLevel(input(0), LEVEL_SEARCH_ICON).searchMode).toBe('icon');
		// With the magnifier the row is 312; the name shortens to its floor before anything folds.
		expect(fittingLevel(input(312 + 338 - 1))).toBe(LEVEL_NAME_FLOOR);
		expect(fittingLevel(input(312 + 236))).toBe(LEVEL_NAME_FLOOR);
	});

	it('folds two actions at once when one would only make room for the menu button', () => {
		const level = fittingLevel(input(312 + 236 - 1));
		const layout = layoutAtLevel(input(0), level);
		expect([...layout.folded]).toEqual(['developer-tools', 'favorite']);
	});

	it('folds in order until it fits, the search box and the call buttons last', () => {
		// Members, the magnifier and the menu button: 3 * 32 + 2 * 8 = 112.
		const layout = layoutAtLevel(input(0), fittingLevel(input(120 + 236)));
		expect([...layout.folded]).toEqual(['developer-tools', 'favorite', 'bell', 'threads', 'pins', 'inbox']);
	});

	it('folds everything when nothing fits', () => {
		const tiny = input(100);
		expect(fittingLevel(tiny)).toBe(maxLevel(tiny));
		expect(layoutAtLevel(tiny, maxLevel(tiny)).folded.size).toBe(ROW.length);
	});

	it('never folds a lone action into the menu, which would gain nothing', () => {
		const lone = input(100, {items: [icon('inbox', 8)], search: null});
		expect(layoutAtLevel(lone, fittingLevel(lone)).folded.size).toBe(0);
		// With more than one, folding them all still leaves the least to fit.
		const two = input(100, {items: [icon('pins', 7), icon('inbox', 8)], search: null});
		expect(layoutAtLevel(two, fittingLevel(two)).folded.size).toBe(2);
	});

	it('counts what folds out of the title as room for the name', () => {
		const items: Array<HeaderLayoutItem> = [
			{key: 'follow', kind: 'action', width: 63, foldOrder: 1, inTitle: true},
			icon('bell', 4),
			icon('inbox', 8),
		];
		// Title with the Follow button: 236 at the floor. Without the menu: icons 32 + 8 + 32 = 72.
		const base = {items, search: null, leftFloor: 236, leftComfort: 236};
		expect(fittingLevel(input(72 + 236, base))).toBe(0);
		// Folding the Follow button frees 63 px of title and adds the menu button (32 + 8).
		const level = fittingLevel(input(72 + 236 - 20, base));
		expect([...layoutAtLevel(input(0, base), level).folded]).toEqual(['follow']);
	});

	it('hides information that is not an action and never folds it', () => {
		const items: Array<HeaderLayoutItem> = [{key: 'supplement', kind: 'info', width: 200, foldOrder: 0}, ...ROW];
		expect(foldSequence(items).some((item) => item.key === 'supplement')).toBe(false);
		expect(fittingLevel(input(524 + 338, {items}))).toBe(LEVEL_HIDE_INFO);
	});

	it('reports the row and title widths the grid is given', () => {
		// Full row; title at its comfortable width.
		expect(widthsAtLevel(input(0), 0)).toEqual({row: 524, left: 338});
		// Magnifier, two actions folded into the menu: 6 icons + the menu button + 6 gaps.
		const level = fittingLevel(input(312 + 236 - 1));
		expect(widthsAtLevel(input(0), level)).toEqual({row: 7 * 32 + 6 * 8, left: 236});
		// A short title needs less than the 10rem the stylesheet falls back to: the row is measured
		// against the title's own width, so the grid must be told the title's share, not 10rem.
		const short = input(312 + 131, {leftComfort: 131, leftFloor: 131});
		expect(fittingLevel(short)).toBe(LEVEL_SEARCH_ICON);
		expect(widthsAtLevel(short, LEVEL_SEARCH_ICON).row).toBe(312);
	});

	it('narrows at once but widens only when the room exceeds the need by the band', () => {
		const band = 16;
		const narrow = input(312 + 236 - 1);
		const folded = nextLevel(narrow, 0, band);
		expect(folded).toBeGreaterThan(LEVEL_NAME_FLOOR);
		// Just enough room again: it stays folded.
		expect(nextLevel(input(312 + 236), folded, band)).toBe(folded);
		expect(nextLevel(input(312 + 236 + band - 1), folded, band)).toBe(folded);
		// Room to spare: it unfolds.
		expect(nextLevel(input(312 + 236 + band), folded, band)).toBe(LEVEL_NAME_FLOOR);
		// The first measurement takes the fitting level as it is.
		expect(nextLevel(input(524 + 338), null, band)).toBe(0);
	});
});
