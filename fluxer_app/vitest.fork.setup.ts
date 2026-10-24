// SPDX-License-Identifier: AGPL-3.0-or-later

import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {when} from 'mobx';
import {afterAll, beforeAll, vi} from 'vitest';
import {trackIntervals} from './src/features/persona/__fixtures__/IntervalTracker';

// What upstream's vitest.setup.ts provided until upstream removed it with its web tests (2026-10-21).

interface TestLockManager {
	request<Result>(name: string, operation: () => Promise<Result>): Promise<Result>;
}

function createTestLockManager(): TestLockManager {
	const tails = new Map<string, Promise<void>>();
	return {
		request<Result>(name: string, operation: () => Promise<Result>): Promise<Result> {
			const result = (tails.get(name) ?? Promise.resolve()).then(operation);
			const tail = result.then(
				() => undefined,
				() => undefined,
			);
			tails.set(name, tail);
			void tail.then(() => {
				if (tails.get(name) === tail) {
					tails.delete(name);
				}
			});
			return result;
		},
	};
}

if (typeof window !== 'undefined' && window.localStorage === undefined && typeof Storage === 'function') {
	Object.defineProperty(window, 'localStorage', {value: new Storage(), configurable: true, writable: true});
}

if (typeof navigator !== 'undefined' && navigator.locks == null) {
	Object.defineProperty(navigator, 'locks', {value: createTestLockManager(), configurable: true, writable: true});
}

// The app fetches its wasm files by URL (see vitest.fork.config.ts, which turns a .wasm import into
// such a URL). No server answers it in tests, so the setup answers it with the file on disk.
const FORK_WASM_URL_PREFIX = 'http://fork-test-wasm.invalid';
const fetchBeforeSetup = globalThis.fetch;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
	if (typeof input === 'string') {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
}

globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
	const url = requestUrl(input);
	if (url.startsWith(FORK_WASM_URL_PREFIX) && url.endsWith('.wasm')) {
		return Promise.resolve(new Response(readFileSync(url.slice(FORK_WASM_URL_PREFIX.length))));
	}
	return fetchBeforeSetup(input, init);
}) as typeof fetch;

// The markdown parser now loads its wasm in the background; tests parse synchronously, as they
// did while upstream inlined it, so it is loaded before they run.
beforeAll(async () => {
	const parser = await import('./src/features/messaging/utils/markdown/parser/MarkdownParserWasm');
	if (typeof parser.isMarkdownParserReady !== 'function' || typeof parser.parseMarkdownAstWithWasm !== 'function') {
		return;
	}
	parser.parseMarkdownAstWithWasm('', 0);
	await when(() => parser.isMarkdownParserReady(), {timeout: 10_000});
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (d: {message?: string}) => d?.message ?? '', locale: 'en'}}),
}));

// Stops every repeating timer a test file leaves running, before its environment is torn
// down. See `trackIntervals` for why.
const intervals = trackIntervals(globalThis);

afterAll(() => {
	intervals.clearLeftovers();
});
