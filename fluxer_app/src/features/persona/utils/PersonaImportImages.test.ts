// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import {personaImportBatchURL, storeTagIcon} from '@app/features/persona/utils/PersonaImportImages';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const runtime = vi.hoisted(() => ({transportApiEndpoint: '/api', apiCodeVersion: 1}));

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		get transportApiEndpoint() {
			return runtime.transportApiEndpoint;
		},
		get apiCodeVersion() {
			return runtime.apiCodeVersion;
		},
	},
}));
vi.mock('@app/features/platform/state/AuthSession', () => ({default: {token: 'token-1'}}));
vi.mock('@app/features/persona/commands/PersonaCommands', () => ({
	importPersonaImage: vi.fn(),
	personaErrorMessage: () => null,
}));

const DESKTOP_TEMPLE = `fluxer-app://app/api/${encodeURIComponent('https://temple.hypersystem.xyz/api')}`;
const ICON_URL = 'https://cdn.example/icon.png';

function remoteIconSource(): PersonaImportSource {
	return {
		kind: 'bundle',
		manifest: {tag_icon: null, tag_icon_url: ICON_URL},
		images: new Map(),
	} as unknown as PersonaImportSource;
}

function streamed(lines: ReadonlyArray<object>): Response {
	return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), {status: 200});
}

describe('persona import picture batch (tyne-chat/tyne#360)', () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		runtime.transportApiEndpoint = '/api';
		runtime.apiCodeVersion = 1;
	});

	it('on desktop, goes through the instance route, not /api/v1', () => {
		runtime.transportApiEndpoint = `${DESKTOP_TEMPLE}/`;
		expect(personaImportBatchURL()).toBe(`${DESKTOP_TEMPLE}/v1/users/@me/personas/import-batch-avatars`);
	});

	it('on the web, keeps the API base and version the REST client uses', () => {
		runtime.apiCodeVersion = 2;
		expect(personaImportBatchURL()).toBe('/api/v2/users/@me/personas/import-batch-avatars');
	});

	it('sends one request for a remote picture, to that URL, and stores the hash', async () => {
		runtime.transportApiEndpoint = DESKTOP_TEMPLE;
		fetchMock.mockResolvedValue(
			streamed([{type: 'complete', results: {[ICON_URL]: {avatar_hash: 'abc', avatar_color: null}}}]),
		);

		const result = await storeTagIcon(remoteIconSource(), null, null);

		expect(result).toEqual({hash: 'abc', error: null});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${DESKTOP_TEMPLE}/v1/users/@me/personas/import-batch-avatars`);
		expect(init?.headers).toMatchObject({Authorization: 'token-1'});
		expect(JSON.parse(String(init?.body))).toEqual({urls: [ICON_URL], kind: 'avatar'});
	});

	it('gives up after one refused request and reports it', async () => {
		fetchMock.mockResolvedValue(new Response('{}', {status: 429}));

		const result = await storeTagIcon(remoteIconSource(), null, null);

		expect(result.hash).toBeUndefined();
		expect(result.error).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
