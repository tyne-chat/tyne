// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	calculatePersonaFrecencyScore,
	calculatePersonaMatchScore,
	clearPersonaMentionCache,
	filterPersonaMentions,
	getCachedPersonaMentionItems,
	invalidatePersonaMentionCache,
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
				avatar_hash: 'b3b3b3b3',
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

function persona(id: string, name: string, extra: Partial<ChannelPersonaMentionItem> = {}): ChannelPersonaMentionItem {
	return {
		id,
		name,
		visibility: 'public',
		use_count: 0,
		last_used_at_ms: null,
		owner_user_id: 'u1',
		owner_username: 'owner',
		...extra,
	};
}

const ALICE = persona('p-alice', 'Alice');
const BOB = persona('p-bob', 'Bob');
const HOUR = 60 * 60 * 1000;

// "Network calls" in the root AGENTS.md: how many requests typing after `@` sends, with the data
// missing and with the request failing. Each request is held until the test answers it.
describe('the requests useAutocompletePersonaSearch sends', () => {
	interface HeldRequest {
		url: string;
		q: string;
		answer: (items: Array<ChannelPersonaMentionItem>) => void;
		refuse: (status: number) => void;
		fail: () => void;
	}

	let container: HTMLDivElement;
	let root: Root;
	let requests: Array<HeldRequest>;

	type HookProps = Parameters<typeof useAutocompletePersonaSearch>[0];
	let latest: Array<ChannelPersonaMentionItem>;

	function Probe(props: HookProps) {
		latest = useAutocompletePersonaSearch(props);
		return null;
	}

	const show = (props: HookProps) =>
		act(() => {
			root.render(createElement(Probe, props));
		});
	const type = (matchedText: string, channelId = 'channel-1', guildId: string | null = 'guild-1') =>
		show({triggerType: 'mention', matchedText, channelId, guildId});
	const wait = (ms: number) =>
		act(async () => {
			vi.advanceTimersByTime(ms);
		});
	const settle = (run: () => void) =>
		act(async () => {
			run();
		});

	beforeEach(() => {
		vi.useFakeTimers();
		clearPersonaMentionCache();
		requests = [];
		latest = [];
		vi.mocked(http.get).mockReset();
		vi.mocked(http.get).mockImplementation(
			((url: string, options: {query: {q: string}}) =>
				new Promise((resolve, reject) => {
					requests.push({
						url,
						q: options.query.q,
						answer: (items) => resolve({ok: true, status: 200, body: items, headers: new Headers()}),
						refuse: (status) => resolve({ok: false, status, body: {code: 'RATE_LIMITED'}, headers: new Headers()}),
						fail: () => reject(new Error('offline')),
					});
				})) as never,
		);
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.mocked(http.get).mockReset();
		clearPersonaMentionCache();
		vi.useRealTimers();
	});

	it('sends one request for a burst of typing, 60 ms after the last change', async () => {
		type('a');
		await wait(30);
		type('al');
		await wait(30);
		type('ali');
		await wait(59);
		expect(requests).toHaveLength(0);

		await wait(1);
		expect(requests.map((request) => request.q)).toEqual(['ali']);
		expect(requests[0]?.url).toContain('/channels/channel-1/persona-mentions');
	});

	it('asks at once for a bare @', async () => {
		type('');
		await wait(0);
		expect(requests.map((request) => request.q)).toEqual(['']);
	});

	it('sends nothing while a fresh cache of the channel matches, and asks again once it is 15 minutes old', async () => {
		type('ali');
		await wait(60);
		await settle(() => requests[0]?.answer([ALICE, BOB]));
		expect(latest.map((item) => item.id)).toEqual([ALICE.id]);

		type('alic');
		await wait(1000);
		type('b');
		await wait(1000);
		expect(requests).toHaveLength(1);
		expect(latest.map((item) => item.id)).toEqual([BOB.id]);

		await wait(15 * 60 * 1000);
		type('bo');
		expect(latest.map((item) => item.id)).toEqual([BOB.id]);
		await wait(60);
		expect(requests.map((request) => request.q)).toEqual(['ali', 'bo']);
	});

	it('asks again for a word no cached persona matches, once per pause', async () => {
		type('ali');
		await wait(60);
		await settle(() => requests[0]?.answer([ALICE]));

		type('zed');
		await wait(60);
		await settle(() => requests[1]?.answer([]));
		type('zeds');
		await wait(60);

		expect(requests.map((request) => request.q)).toEqual(['ali', 'zed', 'zeds']);
	});

	it('does not cache a failed request or ask again for the same query, and asks once for the next one', async () => {
		type('ali');
		await wait(60);
		await settle(() => requests[0]?.fail());

		// Re-rendering with the same query is not a change, so nothing retries.
		type('ali');
		await wait(10_000);
		expect(requests).toHaveLength(1);
		expect(latest).toEqual([]);
		expect(getCachedPersonaMentionItems()).toEqual([]);

		type('alic');
		await wait(60);
		expect(requests.map((request) => request.q)).toEqual(['ali', 'alic']);
	});

	it('does not cache an error answer such as a 429, or retry it', async () => {
		type('ali');
		await wait(60);
		await settle(() => requests[0]?.refuse(429));

		type('ali');
		await wait(10_000);
		expect(requests).toHaveLength(1);
		expect(latest).toEqual([]);
		expect(getCachedPersonaMentionItems()).toEqual([]);
	});

	it('shows nothing for an empty answer, and the next query still asks', async () => {
		type('ali');
		await wait(60);
		await settle(() => requests[0]?.answer([]));
		expect(latest).toEqual([]);

		type('alic');
		await wait(60);
		expect(requests).toHaveLength(2);
	});

	it('does not share overlapping requests, and drops the late answer to an older query', async () => {
		type('a');
		await wait(60);
		type('b');
		await wait(60);
		expect(requests.map((request) => request.q)).toEqual(['a', 'b']);

		await settle(() => requests[1]?.answer([BOB]));
		await settle(() => requests[0]?.answer([ALICE]));

		expect(latest.map((item) => item.id)).toEqual([BOB.id]);
		expect(getCachedPersonaMentionItems().map((item) => item.id)).toEqual([BOB.id]);
	});

	it('sends nothing outside a mention, or without a channel', async () => {
		show({triggerType: 'emoji', matchedText: 'ali', channelId: 'channel-1'});
		await wait(1000);
		show({triggerType: 'mention', matchedText: 'ali', channelId: null});
		await wait(1000);
		expect(requests).toHaveLength(0);
	});

	describe('the cache other code clears', () => {
		async function load(channelId: string, guildId: string | null, items: Array<ChannelPersonaMentionItem>) {
			type('', channelId, guildId);
			await wait(0);
			await settle(() => requests.at(-1)?.answer(items));
		}

		const cachedIds = () =>
			getCachedPersonaMentionItems()
				.map((item) => item.id)
				.sort();

		it('lists every cached persona once, across channels', async () => {
			await load('channel-1', 'guild-1', [ALICE, BOB]);
			await load('channel-2', 'guild-1', [{...ALICE, name: 'Alice again'}]);

			expect(cachedIds()).toEqual([ALICE.id, BOB.id]);
		});

		it('clears one channel, or all of them', async () => {
			await load('channel-1', 'guild-1', [ALICE]);
			await load('channel-2', 'guild-2', [BOB]);

			clearPersonaMentionCache('channel-1');
			expect(cachedIds()).toEqual([BOB.id]);

			clearPersonaMentionCache();
			expect(cachedIds()).toEqual([]);
		});

		it("clears a guild's channels and the channels outside any guild, and keeps other guilds'", async () => {
			const CAROL = persona('p-carol', 'Carol');
			await load('channel-1', 'guild-1', [ALICE]);
			await load('channel-2', 'guild-2', [BOB]);
			await load('dm-1', null, [CAROL]);

			invalidatePersonaMentionCache('guild-1');
			expect(cachedIds()).toEqual([BOB.id]);

			invalidatePersonaMentionCache();
			expect(cachedIds()).toEqual([]);
		});

		it('asks again in a channel whose cache was cleared', async () => {
			await load('channel-1', 'guild-1', [ALICE]);
			type('ali', 'channel-1', 'guild-1');
			await wait(1000);
			expect(requests).toHaveLength(1);

			invalidatePersonaMentionCache('guild-1');
			type('alic', 'channel-1', 'guild-1');
			await wait(60);
			expect(requests).toHaveLength(2);
		});
	});
});

describe('persona mention ranking', () => {
	const NOW = Date.UTC(2026, 10, 4, 12);

	it('gives each match a tier: name, then display tag, then owner', () => {
		const score = (
			name: string,
			query: string,
			tag?: string | null,
			username?: string | null,
			nick?: string | null,
			global?: string | null,
		) => calculatePersonaMatchScore(name, query, tag, username, nick, global);

		expect(score('Alice', 'ali')).toBe(1000);
		expect(score('Mad Alice', 'ali')).toBe(800);
		expect(score('Mad-Alice', 'ali')).toBe(800);
		expect(score('Mad_Alice', 'ali')).toBe(800);
		expect(score('Malice', 'ali')).toBe(500);
		expect(score('Bob', 'won', 'Wonderland')).toBe(350);
		expect(score('Bob', 'land', 'Wonderland')).toBe(250);
		expect(score('Bob', 'chi', null, 'chiara')).toBe(150);
		expect(score('Bob', 'chi', null, null, 'Chiara')).toBe(150);
		expect(score('Bob', 'chi', null, null, null, 'Chiara')).toBe(150);
		expect(score('Bob', 'ara', null, 'chiara')).toBe(100);
		expect(score('Bob', 'ara', null, null, 'Chiara')).toBe(100);
		expect(score('Bob', 'ara', null, null, null, 'Chiara')).toBe(100);
		expect(score('Bob', 'zed', 'Wonderland', 'chiara')).toBe(-1);
		expect(score('Bob', '   ')).toBe(0);
	});

	it('boosts a persona by how recently it was used', () => {
		const boost = (ageMs: number) => calculatePersonaFrecencyScore(0, NOW - ageMs, NOW);

		expect(boost(5 * 60 * 1000)).toBe(120);
		expect(boost(30 * 60 * 1000)).toBe(90);
		expect(boost(5 * HOUR)).toBe(60);
		expect(boost(48 * HOUR)).toBe(35);
		expect(boost(100 * HOUR)).toBe(15);
		expect(boost(400 * HOUR)).toBe(5);
		expect(boost(1000 * HOUR)).toBe(0);
	});

	it('reads the last use as a string or a bigint, and only counts uses when there is none', () => {
		const countScore = Math.log10(10) * 20;

		expect(calculatePersonaFrecencyScore(9, String(NOW - 5 * HOUR), NOW)).toBeCloseTo(countScore + 60);
		expect(calculatePersonaFrecencyScore(9, BigInt(NOW - 5 * HOUR), NOW)).toBeCloseTo(countScore + 60);
		expect(calculatePersonaFrecencyScore(9, null, NOW)).toBeCloseTo(countScore);
		expect(calculatePersonaFrecencyScore(9, 0, NOW)).toBeCloseTo(countScore);
		expect(calculatePersonaFrecencyScore(9, 'not a time', NOW)).toBeCloseTo(countScore);
		expect(calculatePersonaFrecencyScore(-5, null, NOW)).toBe(0);
		expect(calculatePersonaFrecencyScore(undefined, undefined, NOW)).toBe(0);
	});

	it('lists every persona for an empty query, the most used first and then by name', () => {
		vi.useFakeTimers({now: NOW});
		try {
			const items = [
				persona('p-zoe', 'Zoe', {use_count: 3}),
				persona('p-bea', 'bea'),
				persona('p-amy', 'Amy'),
				persona('p-max', 'Max', {last_used_at_ms: String(NOW - 10 * 60 * 1000)}),
			];

			expect(filterPersonaMentions(items, '  ').map((item) => item.name)).toEqual(['Max', 'Zoe', 'Amy', 'bea']);
		} finally {
			vi.useRealTimers();
		}
	});

	it("matches on the display tag and the owner's names, and drops what matches nothing", () => {
		const items = [
			persona('p-1', 'Fern', {owner_username: 'chiara'}),
			persona('p-2', 'Moss', {display_tag_text: 'Chime system'}),
			persona('p-3', 'Chip'),
			persona('p-4', 'Reed'),
		];

		expect(filterPersonaMentions(items, 'chi').map((item) => item.name)).toEqual(['Chip', 'Moss', 'Fern']);
	});
});
