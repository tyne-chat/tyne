// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {ForkAudioWaveform} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioWaveform';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const WAVEFORM = btoa(String.fromCharCode(0, 64, 128, 255, 128, 64, 0, 32));

describe('ForkAudioWaveform', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	function render(props: Partial<Parameters<typeof ForkAudioWaveform>[0]> = {}) {
		const onSeek = vi.fn();
		act(() => {
			root.render(
				<ForkAudioWaveform
					waveform={WAVEFORM}
					progress={50}
					playing={false}
					label="Audio progress"
					valueText="0:03 / 0:07"
					onSeek={onSeek}
					data-flx="channel.embeds.media.fork-audio.fork-audio-waveform-test.fork-audio-waveform"
					{...props}
				/>,
			);
		});
		const slider = container.querySelector('[role="slider"]') as HTMLElement;
		return {slider, onSeek};
	}

	it('is a slider at the playback position', () => {
		const {slider} = render();
		expect(slider.getAttribute('aria-label')).toBe('Audio progress');
		expect(slider.getAttribute('aria-valuenow')).toBe('50');
		expect(slider.getAttribute('aria-valuetext')).toBe('0:03 / 0:07');
		expect(slider.tabIndex).toBe(0);
	});

	it('draws bars from the waveform, the first half played', () => {
		const {slider} = render();
		const bars = Array.from(slider.children) as Array<HTMLElement>;
		expect(bars.length).toBeGreaterThanOrEqual(12);
		const played = bars.filter((bar) => bar.className.includes('barPlayed'));
		expect(played.length).toBe(bars.length / 2);
	});

	it('colours the played part only while playing', () => {
		const paused = render({playing: false}).slider;
		expect(paused.querySelector('[class*="barPlayedIdle"]')).not.toBeNull();
		expect(paused.querySelector('[class*="barPlayedActive"]')).toBeNull();
		const playing = render({playing: true}).slider;
		expect(playing.querySelector('[class*="barPlayedActive"]')).not.toBeNull();
	});

	it('is a plain bar without a waveform', () => {
		const {slider} = render({waveform: null});
		expect(slider.querySelector('[class*="line"]')).not.toBeNull();
		expect(slider.querySelector('[class*="bar"]')).toBeNull();
	});

	it('seeks with the arrow keys and Home', () => {
		const {slider, onSeek} = render();
		act(() => {
			slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
		});
		expect(onSeek).toHaveBeenLastCalledWith(55);
		act(() => {
			slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
		});
		expect(onSeek).toHaveBeenLastCalledWith(45);
		act(() => {
			slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
		});
		expect(onSeek).toHaveBeenLastCalledWith(0);
	});
});
