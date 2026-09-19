// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {useAutocompletePersonaSearch} from '@app/features/lexical/composer/useAutocompletePersonaSearch';
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

	it('debounces fetch by 150ms and fetches personas for matching query', async () => {
		const mockPersonas: Array<ChannelPersonaMentionItem> = [
			{
				personaId: 'p1',
				personaName: 'Alice',
				personaAvatar: 'hash1',
				personaColor: 0xff0000,
				displayTagText: 'Wonderland',
				systemName: 'Wonderland Sys',
				ownerUserId: 'u1',
				ownerUsername: 'alice_owner',
				ownerDiscriminator: '0001',
				ownerGlobalName: 'Alice O',
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

		// Before 150ms debounce
		vi.advanceTimersByTime(100);
		expect(http.get).not.toHaveBeenCalled();

		// After debounce fires
		await act(async () => {
			vi.advanceTimersByTime(60);
		});

		expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/channels/channel_123/persona-mentions'), {
			query: {q: 'ali'},
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
		vi.advanceTimersByTime(50);
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
});
