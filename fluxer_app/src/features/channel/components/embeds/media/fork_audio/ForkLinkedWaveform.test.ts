// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	forgetForkLinkedWaveforms,
	forkMediaHasLinkedWaveform,
	loadForkLinkedWaveform,
} from '@app/features/channel/components/embeds/media/fork_audio/ForkLinkedWaveform';
import {ForkMessageAttachmentFlags} from '@fluxer/constants/src/ForkAttachmentConstants';
import {afterEach, describe, expect, it, vi} from 'vitest';

const LINK = 'https://media.example/attachments/1/2/Spell.wav?ex=1&is=2&hm=abc';
const OTHER_SIGNATURE = 'https://media.example/attachments/1/2/Spell.wav?ex=3&is=4&hm=def';

function fetcherAnswering(answer: () => Response | Promise<Response>) {
	return vi.fn<typeof fetch>(async () => answer());
}

describe("a link's waveform (tyne-chat/tyne#873)", () => {
	afterEach(() => {
		forgetForkLinkedWaveforms();
	});

	it('is loaded once per linked file, with waveform=1, and read as base64', async () => {
		const fetcher = fetcherAnswering(() => new Response(new Uint8Array([0, 64, 255, 128])));

		const [first, second] = await Promise.all([
			loadForkLinkedWaveform(LINK, fetcher),
			loadForkLinkedWaveform(OTHER_SIGNATURE, fetcher),
		]);
		const later = await loadForkLinkedWaveform(LINK, fetcher);

		expect(first).toBe('AED/gA==');
		expect(second).toBe(first);
		expect(later).toBe(first);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const requested = new URL(String(fetcher.mock.calls[0]![0]));
		expect(requested.pathname).toBe('/attachments/1/2/Spell.wav');
		expect(requested.searchParams.get('waveform')).toBe('1');
		expect(requested.searchParams.get('hm')).toBe('abc');
	});

	it('is not asked again after the file has none (404)', async () => {
		const fetcher = fetcherAnswering(() => new Response('Not Found', {status: 404}));

		expect(await loadForkLinkedWaveform(LINK, fetcher)).toBeNull();
		expect(await loadForkLinkedWaveform(LINK, fetcher)).toBeNull();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('is not asked again after the request fails (offline, 429)', async () => {
		const offline = vi.fn<typeof fetch>(async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(await loadForkLinkedWaveform(LINK, offline)).toBeNull();
		expect(await loadForkLinkedWaveform(LINK, offline)).toBeNull();
		expect(offline).toHaveBeenCalledTimes(1);

		const limited = fetcherAnswering(() => new Response('', {status: 429}));
		expect(await loadForkLinkedWaveform(OTHER_SIGNATURE.replace('/2/', '/3/'), limited)).toBeNull();
		expect(await loadForkLinkedWaveform(OTHER_SIGNATURE.replace('/2/', '/3/'), limited)).toBeNull();
		expect(limited).toHaveBeenCalledTimes(1);
	});

	it('is refused when the answer is empty or too large to be a waveform', async () => {
		expect(
			await loadForkLinkedWaveform(
				LINK,
				fetcherAnswering(() => new Response(new Uint8Array())),
			),
		).toBeNull();
		forgetForkLinkedWaveforms();
		const huge = fetcherAnswering(() => new Response(new Uint8Array(5000)));
		expect(await loadForkLinkedWaveform(LINK, huge)).toBeNull();
	});

	it('is loaded only for audio the server flagged', () => {
		expect(forkMediaHasLinkedWaveform(ForkMessageAttachmentFlags.HAS_WAVEFORM | 16)).toBe(true);
		expect(forkMediaHasLinkedWaveform(ForkMessageAttachmentFlags.HAS_COVER)).toBe(false);
		expect(forkMediaHasLinkedWaveform(undefined)).toBe(false);
	});
});
