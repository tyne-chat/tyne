// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

// tyne-chat/tyne#595: an animated jump whose target moves while it scrolls (the list grows as
// something in it loads) must still land on the target. The real scroller and scroll manager, with
// the frames and the viewport's size driven by the test. The numbers are from a trace on production.

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {default: Accessibility} = await import('@app/features/accessibility/state/Accessibility');
const {ScrollManager} = await import('@app/features/platform/utils/ScrollManager');
const {JumpPreSnap} = await import('@app/features/platform/utils/scroll_manager/shared');
const {Scroller} = await import('@app/features/ui/components/Scroller');

type ScrollManagerProps = ConstructorParameters<typeof ScrollManager>[0];

const CHANNEL_ID = '1549247151249293312';
const TARGET_ID = '1559063768653103104';
const VIEWPORT_HEIGHT = 987;

describe('an animated jump whose target moves while it scrolls (tyne-chat/tyne#595)', () => {
	let container: HTMLDivElement;
	let root: Root;
	let frames: Array<{id: number; callback: FrameRequestCallback}>;
	let nextFrameId: number;
	let clock: number;
	let scrollTop: number;
	let scrollHeight: number;
	let targetTop: number;

	function runFrame(ms = 16): void {
		clock += ms;
		const due = frames;
		frames = [];
		act(() => {
			for (const frame of due) frame.callback(clock);
		});
	}

	function runFramesFor(ms: number): void {
		const until = clock + ms;
		while (clock < until) runFrame();
	}

	const jumpIsActive = (manager: InstanceType<typeof ScrollManager>): boolean =>
		(manager as unknown as {jumpIsActive: boolean}).jumpIsActive;

	function renderManager(): {manager: InstanceType<typeof ScrollManager>; target: HTMLElement} {
		const messages = {
			channelId: CHANNEL_ID,
			ready: true,
			loadingMore: false,
			jumpDestinationId: TARGET_ID,
			jumpDestinationOffset: 0,
			jumpHighlight: true,
			jumpTicket: 3,
			jumpType: 'animated',
			hasMoreBefore: true,
			hasMoreAfter: true,
			has: (id: string) => id === TARGET_ID,
		};
		const props = {
			messages,
			channel: {id: CHANNEL_ID},
			compact: false,
			hasPendingUnreads: false,
			focusAnchorId: null,
			unloadedSpacerHeight: 0,
			allowHistoryFetch: true,
			windowId: 'main',
			notifyPinnedToBottom: () => {},
			notifyUnpinnedFromBottom: () => {},
			extraListPadding: 0,
			canAutoAck: false,
			handleJumpHighlight: () => {},
		} as unknown as ScrollManagerProps;
		const manager = new ScrollManager(props);
		const target = document.createElement('div');
		// Layout is not computed here, so the manager's layout reads are given the trace's numbers.
		Object.assign(manager as unknown as Record<string, unknown>, {
			layoutGetElementFromMessageId: (id: string) => (id === TARGET_ID ? target : null),
			layoutGetNodeAlignedScrollTop: () => targetTop,
			jumpGetCentrePadding: () => 0,
			anchorGetData: () => null,
		});
		act(() => {
			root.render(
				<Scroller ref={manager.ref} data-flx="platform.scroll-manager-jump-retarget-test.render-manager.scroller">
					<div data-flx="platform.scroll-manager-jump-retarget-test.render-manager.div" />
				</Scroller>,
			);
		});
		const viewport = manager.ref.current?.getViewportElement();
		if (!viewport) throw new Error('no viewport');
		Object.defineProperties(viewport, {
			scrollTop: {
				configurable: true,
				get: () => scrollTop,
				set: (value: number) => {
					scrollTop = Math.max(0, Math.min(value, scrollHeight - VIEWPORT_HEIGHT));
				},
			},
			scrollHeight: {configurable: true, get: () => scrollHeight},
			offsetHeight: {configurable: true, get: () => VIEWPORT_HEIGHT},
			clientHeight: {configurable: true, get: () => VIEWPORT_HEIGHT},
		});
		return {manager, target};
	}

	beforeEach(() => {
		frames = [];
		nextFrameId = 1;
		clock = 1000;
		scrollTop = 6095;
		scrollHeight = 8939;
		targetTop = 3736;
		vi.spyOn(performance, 'now').mockImplementation(() => clock);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			const id = nextFrameId++;
			frames.push({id, callback});
			return id;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			frames = frames.filter((frame) => frame.id !== id);
		});
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('lands on the moved target and completes the jump only when it lands', () => {
		expect(Accessibility.useSmoothScrolling).toBe(true);
		const {manager} = renderManager();
		act(() => manager.scrollAlignToMessage(TARGET_ID, true, JumpPreSnap.END));
		expect(scrollTop).toBe(scrollHeight - VIEWPORT_HEIGHT);
		runFramesFor(48);
		const midFlight = scrollTop;
		expect(midFlight).toBeLessThan(scrollHeight - VIEWPORT_HEIGHT);
		expect(midFlight).toBeGreaterThan(targetTop);

		// Something above the target finishes loading: the list grows by 11 px and the target moves
		// down by as much, as in the trace.
		scrollHeight += 11;
		targetTop += 8;
		act(() => manager.scrollFixPosition(VIEWPORT_HEIGHT, scrollHeight));

		expect(scrollTop).toBe(midFlight);
		expect(jumpIsActive(manager)).toBe(true);

		runFramesFor(1500);
		expect(scrollTop).toBe(3744);
		expect(jumpIsActive(manager)).toBe(false);
	});

	it('scrolls straight to the target when no animation is running', () => {
		const {manager} = renderManager();
		const callback = vi.fn();
		act(() => manager.ref.current?.retargetTo({to: 4000, callback}));
		expect(scrollTop).toBe(4000);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it('keeps the running animation callback and runs both when it lands', () => {
		const {manager} = renderManager();
		const first = vi.fn();
		const second = vi.fn();
		act(() => manager.ref.current?.scrollTo({to: 3000, animate: true, callback: first}));
		runFrame();
		act(() => manager.ref.current?.retargetTo({to: 3500, callback: second}));
		expect(first).not.toHaveBeenCalled();
		expect(second).not.toHaveBeenCalled();
		runFramesFor(1500);
		expect(scrollTop).toBe(3500);
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
	});
});
