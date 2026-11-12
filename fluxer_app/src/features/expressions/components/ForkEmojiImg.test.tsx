// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {ForkEmojiImg} from '@app/features/expressions/components/ForkEmojiImg';
import {createForkEmojiTimeline} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import {
	type ForkEmojiStripState,
	forkEmojiNearViewport,
	forkEmojiStrips,
	forkSyncedEmojiPlayer,
} from '@app/features/expressions/utils/ForkSyncedEmojiPlayback';
import {ReactionImage} from '@app/features/messaging/components/ReactionImage';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const ANIMATED_URL = 'https://media.example/emojis/1553996962712256512.webp?animated=true&size=128';
const STATIC_URL = 'https://media.example/emojis/1553996962712256512.webp?size=128';
const READY: ForkEmojiStripState = {
	status: 'ready',
	strip: {url: 'blob:wings', frameCount: 3, timeline: createForkEmojiTimeline([100, 100, 100])},
};

let container: HTMLDivElement;
let root: Root;

function render(element: React.ReactElement): HTMLImageElement {
	act(() => {
		root.render(element);
	});
	return container.querySelector('img')!;
}

// Makes the browser look able to decode emoji frames; emoji start near the viewport unless `near` is
// false. Returns a function that moves them in or out of it.
function installImageDecoderSupport({near = true}: {near?: boolean} = {}): (near: boolean) => void {
	vi.stubGlobal(
		'ImageDecoder',
		Object.assign(function FakeImageDecoder() {}, {isTypeSupported: async () => true}),
	);
	vi.stubGlobal('OffscreenCanvas', class {});
	const listeners = new Set<(near: boolean) => void>();
	vi.spyOn(forkEmojiNearViewport, 'observe').mockImplementation((_element, listener) => {
		listeners.add(listener);
		if (near) listener(true);
		return () => {
			listeners.delete(listener);
		};
	});
	return (value) => {
		act(() => {
			for (const listener of listeners) listener(value);
		});
	};
}

beforeEach(() => {
	(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ForkEmojiImg', () => {
	it("is upstream's <img> in a browser without ImageDecoder", () => {
		const acquire = vi.spyOn(forkEmojiStrips, 'acquire');
		const img = render(
			<ForkEmojiImg src={ANIMATED_URL} alt="WingsL" className="emoji" data-flx="test.emoji" draggable={false} />,
		);
		expect(img.getAttribute('src')).toBe(ANIMATED_URL);
		expect(img.getAttribute('alt')).toBe('WingsL');
		expect(img.className).toBe('emoji');
		expect(img.getAttribute('style')).toBeNull();
		expect(acquire).not.toHaveBeenCalled();
	});

	it('leaves still emoji alone', () => {
		installImageDecoderSupport();
		const acquire = vi.spyOn(forkEmojiStrips, 'acquire');
		const img = render(<ForkEmojiImg src={STATIC_URL} alt="WingsL" data-flx="test.emoji" />);
		expect(img.getAttribute('src')).toBe(STATIC_URL);
		expect(acquire).not.toHaveBeenCalled();
	});

	it('hides an animated emoji while its frames load, so it does not start out of step', () => {
		installImageDecoderSupport();
		const release = vi.fn();
		const acquire = vi.spyOn(forkEmojiStrips, 'acquire').mockReturnValue(release);
		vi.spyOn(forkEmojiStrips, 'peek').mockReturnValue({status: 'loading'});
		const img = render(<ForkEmojiImg src={ANIMATED_URL} alt="WingsL" data-flx="test.emoji" />);
		expect(acquire).toHaveBeenCalledWith(ANIMATED_URL);
		expect(img.getAttribute('src')).toBe(ANIMATED_URL);
		expect(img.style.opacity).toBe('0');
		act(() => {
			root.unmount();
		});
		expect(release).toHaveBeenCalledTimes(1);
		root = createRoot(container);
	});

	it('fetches the frames of an emoji only once it comes near the viewport, and lets them go when it leaves', () => {
		const setNear = installImageDecoderSupport({near: false});
		const release = vi.fn();
		const acquire = vi.spyOn(forkEmojiStrips, 'acquire').mockReturnValue(release);
		render(<ForkEmojiImg src={ANIMATED_URL} alt="WingsL" data-flx="test.emoji" />);
		expect(acquire).not.toHaveBeenCalled();
		setNear(true);
		expect(acquire).toHaveBeenCalledTimes(1);
		setNear(false);
		expect(release).toHaveBeenCalledTimes(1);
		expect(acquire).toHaveBeenCalledTimes(1);
	});

	it("falls back to upstream's <img> when the frames could not be loaded", () => {
		installImageDecoderSupport();
		vi.spyOn(forkEmojiStrips, 'acquire').mockReturnValue(() => {});
		vi.spyOn(forkEmojiStrips, 'peek').mockReturnValue({status: 'failed'});
		const img = render(<ForkEmojiImg src={ANIMATED_URL} alt="WingsL" style={{opacity: 0.5}} data-flx="test.emoji" />);
		expect(img.getAttribute('src')).toBe(ANIMATED_URL);
		expect(img.style.opacity).toBe('0.5');
	});

	it('shows the strip in the same <img> and hands it to the player', () => {
		installImageDecoderSupport();
		vi.spyOn(forkEmojiStrips, 'acquire').mockReturnValue(() => {});
		vi.spyOn(forkEmojiStrips, 'peek').mockReturnValue(READY);
		const detach = vi.fn();
		const attach = vi.spyOn(forkSyncedEmojiPlayer, 'attach').mockReturnValue(detach);
		const ref = vi.fn();
		const img = render(
			<ForkEmojiImg ref={ref} src={ANIMATED_URL} alt="WingsL" className="emoji jumboable" data-flx="test.emoji" />,
		);
		expect(img.getAttribute('src')).toBe('blob:wings');
		expect(img.getAttribute('alt')).toBe('WingsL');
		expect(img.className).toBe('emoji jumboable');
		expect(img.style.objectFit).toBe('cover');
		expect(attach).toHaveBeenCalledWith(img, READY.status === 'ready' ? READY.strip : null);
		expect(ref).toHaveBeenCalledWith(img);
		act(() => {
			root.unmount();
		});
		expect(detach).toHaveBeenCalledTimes(1);
		root = createRoot(container);
	});

	it("is what upstream's ReactionImage renders", () => {
		installImageDecoderSupport();
		vi.spyOn(forkEmojiStrips, 'acquire').mockReturnValue(() => {});
		vi.spyOn(forkEmojiStrips, 'peek').mockReturnValue(READY);
		vi.spyOn(forkSyncedEmojiPlayer, 'attach').mockReturnValue(() => {});
		const img = render(
			<ReactionImage src={ANIMATED_URL} alt="WingsR" data-flx="expressions.fork-emoji-img-test.reaction-image" />,
		);
		expect(img.getAttribute('src')).toBe('blob:wings');
		expect(img.getAttribute('alt')).toBe('WingsR');
	});
});
