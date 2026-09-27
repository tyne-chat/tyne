// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	calculatePersonaFrecencyScore,
	clearPersonaMentionCache,
	filterPersonaMentions,
	useAutocompletePersonaSearch,
} from '@app/features/lexical/composer/useAutocompletePersonaSearch';
import {http} from '@app/features/platform/transport/RestTransport';
import type {ChannelPersonaMentionItem} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@app/features/platform/transport/RestTransport', () => ({
	http: {
		get: vi.fn(),
	},
}));

describe('useAutocompletePersonaSearch', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		clearPersonaMentionCache();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
	});

	function renderTestHook(props: {
		triggerType: string | null;
		matchedText: string;
		channelId: string | null | undefined;
		guildId?: string | null;
		onResults?: (results: Array<ChannelPersonaMentionItem>) => void;
	}) {
		let latestResults: Array<ChannelPersonaMentionItem> = [];
		function TestComponent(currentProps: typeof props) {
			const res = useAutocompletePersonaSearch(currentProps);
			latestResults = res;
			currentProps.onResults?.(res);
			return null;
		}

		act(() => {
			root.render(createElement(TestComponent, props));
		});

		return {
			getResults: () => latestResults,
			update: (newProps: typeof props) => {
				act(() => {
					root.render(createElement(TestComponent, newProps));
				});
			},
		};
	}

	it('returns empty array when triggerType is not mention', () => {
		const {getResults} = renderTestHook({
			triggerType: 'emoji',
			matchedText: 'alice',
			channelId: 'channel_123',
		});

		vi.advanceTimersByTime(200);
		expect(getResults()).toEqual([]);
		expect(http.get).not.toHaveBeenCalled();
	});

	it('returns empty array when channelId is null or undefined', () => {
		const {getResults} = renderTestHook({
			triggerType: 'mention',
			matchedText: 'alice',
			channelId: null,
		});

		vi.advanceTimersByTime(200);
		expect(getResults()).toEqual([]);
		expect(http.get).not.toHaveBeenCalled();
	});

	it('debounces fetch by 60ms and fetches personas for matching query', async () => {
		const mockPersonas: Array<ChannelPersonaMentionItem> = [
			{
				id: 'p1',
				name: 'Alice',
				avatar_hash: 'hash1',
				color: 0xff0000,
				display_tag_text: 'Wonderland Sys',
				visibility: 'public',
				use_count: 0,
				last_used_at_ms: null,
				owner_user_id: 'u1',
				owner_username: 'alice_owner',
				owner_global_name: 'Alice O',
			},
		];

		vi.mocked(http.get).mockResolvedValueOnce({
			ok: true,
			status: 200,
			body: mockPersonas,
			headers: new Headers(),
		} as any);

		const {getResults} = renderTestHook({
			triggerType: 'mention',
			matchedText: '  ali  ',
			channelId: 'channel_123',
		});

		// Before 60ms debounce
		vi.advanceTimersByTime(30);
		expect(http.get).not.toHaveBeenCalled();

		// After debounce fires
		await act(async () => {
			vi.advanceTimersByTime(40);
		});

		expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/channels/channel_123/persona-mentions'), {
			query: {q: 'ali', limit: 500},
		});
		expect(getResults()).toEqual(mockPersonas);
	});

	it('clears results and aborts timer when switching away from mention', async () => {
		const {getResults, update} = renderTestHook({
			triggerType: 'mention',
			matchedText: 'ali',
			channelId: 'channel_123',
		});

		// Switch before debounce expires
		vi.advanceTimersByTime(20);
		update({
			triggerType: null,
			matchedText: '',
			channelId: 'channel_123',
		});

		vi.advanceTimersByTime(200);
		expect(http.get).not.toHaveBeenCalled();
		expect(getResults()).toEqual([]);
	});

	it('gracefully handles API errors without crashing', async () => {
		vi.mocked(http.get).mockRejectedValueOnce(new Error('Network error'));

		const {getResults} = renderTestHook({
			triggerType: 'mention',
			matchedText: 'error_query',
			channelId: 'channel_123',
		});

		await act(async () => {
			vi.advanceTimersByTime(200);
		});

		expect(http.get).toHaveBeenCalled();
		expect(getResults()).toEqual([]);
	});

	describe('frecency and ranking scoring', () => {
		it('calculates higher frecency score for recently used personas', () => {
			const now = Date.now();
			// Persona A: used 100 times, but 2 days ago (age 48 hours -> recency boost 35)
			// countScore = log10(101) * 20 ≈ 40.08 + 35 = 75.08
			const twoDaysAgo = now - 48 * 60 * 60 * 1000;
			const scoreOldFrequent = calculatePersonaFrecencyScore(100, twoDaysAgo, now);

			// Persona B: used 5 times, but 5 minutes ago (age < 0.25h -> recency boost 120)
			// countScore = log10(6) * 20 ≈ 15.56 + 120 = 135.56
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const scoreRecentFew = calculatePersonaFrecencyScore(5, fiveMinutesAgo, now);

			expect(scoreRecentFew).toBeGreaterThan(scoreOldFrequent);
		});

		it('ranks by query match tier first, then frecency', () => {
			const now = Date.now();
			const items: Array<ChannelPersonaMentionItem> = [
				{
					id: 'p1',
					name: 'Bob Substring (ali)', // substring match (500)
					visibility: 'public',
					owner_user_id: 'u1',
					owner_username: 'user1',
					use_count: 100,
					last_used_at_ms: String(now - 1000), // very recent
				},
				{
					id: 'p2',
					name: 'Alice', // exact prefix match (1000)
					visibility: 'public',
					owner_user_id: 'u2',
					owner_username: 'user2',
					use_count: 0,
					last_used_at_ms: null, // never used
				},
			];

			const sorted = filterPersonaMentions(items, 'ali');
			expect(sorted[0].id).toBe('p2'); // Alice wins due to exact prefix match
			expect(sorted[1].id).toBe('p1');
		});

		it('ranks same-match-tier personas by frecency score', () => {
			const now = Date.now();
			const items: Array<ChannelPersonaMentionItem> = [
				{
					id: 'p1',
					name: 'Alice Old',
					visibility: 'public',
					owner_user_id: 'u1',
					owner_username: 'user1',
					use_count: 10,
					last_used_at_ms: String(now - 5 * 24 * 60 * 60 * 1000), // 5 days ago (+15)
				},
				{
					id: 'p2',
					name: 'Alice Recent',
					visibility: 'public',
					owner_user_id: 'u2',
					owner_username: 'user2',
					use_count: 2,
					last_used_at_ms: String(now - 2 * 60 * 1000), // 2 mins ago (+120)
				},
			];

			const sorted = filterPersonaMentions(items, 'ali');
			expect(sorted[0].id).toBe('p2'); // Alice Recent wins due to recency
			expect(sorted[1].id).toBe('p1');
		});
	});
});
