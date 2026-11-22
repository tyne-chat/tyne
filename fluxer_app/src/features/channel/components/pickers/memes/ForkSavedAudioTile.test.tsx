// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {forgetForkLinkedWaveforms} from '@app/features/channel/components/embeds/media/fork_audio/ForkLinkedWaveform';
import {
	ForkSavedAudioTile,
	forgetMissingSavedAudioCovers,
} from '@app/features/channel/components/pickers/memes/ForkSavedAudioTile';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_URL = 'https://media.example/attachments/7/8/Chime.wav?ex=1&is=2&hm=abc';
const MEME = {filename: 'Chime.wav', contentType: 'audio/wav', duration: 3};

describe('a saved audio file in the Media tab (tyne-chat/tyne#879)', () => {
	let container: HTMLDivElement;
	let root: Root;
	let fetcher: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		fetcher = vi.fn(async () => new Response(new Uint8Array([0, 128, 255, 128])));
		vi.stubGlobal('fetch', fetcher);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		forgetMissingSavedAudioCovers();
		forgetForkLinkedWaveforms();
	});

	function render(memeUrl = SAVED_URL) {
		act(() => {
			root.render(
				<ForkSavedAudioTile
					meme={MEME}
					memeUrl={memeUrl}
					data-flx="channel.pickers.memes.fork-saved-audio-tile-test.tile"
				/>,
			);
		});
	}

	const cover = () => container.querySelector<HTMLImageElement>('[data-flx$="fork-saved-audio-tile.cover"]');
	const bars = () => container.querySelectorAll('[data-flx$="fork-saved-audio-tile.bar"]');

	it('shows the cover with the name, length and format on it, and asks for no waveform', () => {
		render();

		const image = cover();
		expect(image).not.toBeNull();
		const url = new URL(image!.src);
		expect(url.pathname).toBe('/attachments/7/8/Chime.wav');
		expect(url.searchParams.get('cover')).toBe('1');
		expect(container.textContent).toContain('Chime.wav');
		expect(container.textContent).toContain('WAV');
		expect(container.querySelector('svg')).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('falls back to the waveform once the cover is missing, with one request, and asks again for neither', async () => {
		render();
		await act(async () => {
			cover()!.dispatchEvent(new Event('error'));
		});

		expect(cover()).toBeNull();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('waveform')).toBe('1');
		expect(bars().length).toBeGreaterThan(0);
		expect(container.textContent).toContain('Chime.wav');

		act(() => root.unmount());
		root = createRoot(container);
		await act(async () => render(SAVED_URL.replace('hm=abc', 'hm=def')));

		expect(cover()).toBeNull();
		expect(bars().length).toBeGreaterThan(0);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('shows a flat line when the waveform cannot be loaded, without asking again', async () => {
		fetcher.mockImplementation(async () => new Response('', {status: 429}));
		render();
		await act(async () => {
			cover()!.dispatchEvent(new Event('error'));
		});
		await act(async () => render());

		expect(bars()).toHaveLength(0);
		expect(container.querySelector('[data-flx$="fork-saved-audio-tile.line"]')).not.toBeNull();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('loads nothing while it has no URL (not signed yet, or off screen)', () => {
		render('');

		expect(cover()).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});
});
