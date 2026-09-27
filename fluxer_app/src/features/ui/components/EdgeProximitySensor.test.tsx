// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import MemberList from '@app/features/member/state/MemberList';
import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import LayoutState from '@app/features/ui/state/LayoutState';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

installVoiceMenuTestBootstrap();

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {EdgeProximitySensor} = await import('./EdgeProximitySensor');

describe('EdgeProximitySensor', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);

		runInAction(() => {
			MobileLayout.enabled = false;
			LayoutState.setEdgeHoverPeekEnabled(true);
			LayoutState.setLeftSidebarVisible(false);
			LayoutState.setLeftHoverPeeking(false);
			LayoutState.setRightHoverPeeking(false);
			LayoutState.setCanRightPeek(true);
			MemberList.isMembersOpen = false;
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.replaceChildren();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it('does not render any sensors when MobileLayout is enabled', async () => {
		runInAction(() => {
			MobileLayout.enabled = true;
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor" />);
		});

		expect(container.children.length).toBe(0);
	});

	it('does not render any sensors when edgeHoverPeekEnabled is false', async () => {
		runInAction(() => {
			LayoutState.setEdgeHoverPeekEnabled(false);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--2" />);
		});

		expect(container.children.length).toBe(0);
	});

	it('renders left edge sensor when leftSidebarVisible is false and isLeftHoverPeeking is false', async () => {
		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--3" />);
		});

		const leftSensor = container.querySelector('div[class*="sensorLeftEdge"]');
		expect(leftSensor).not.toBeNull();
	});

	it('does not render left edge sensor when leftSidebarVisible is true', async () => {
		runInAction(() => {
			LayoutState.setLeftSidebarVisible(true);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--4" />);
		});

		const leftSensor = container.querySelector('div[class*="sensorLeftEdge"]');
		expect(leftSensor).toBeNull();
	});

	it('activates left hover peeking after intent delay on mouseEnter', async () => {
		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--5" />);
		});

		const leftSensor = container.querySelector('div[class*="sensorLeftEdge"]') as HTMLDivElement;
		expect(leftSensor).not.toBeNull();

		act(() => {
			leftSensor.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, relatedTarget: null}));
			leftSensor.dispatchEvent(new MouseEvent('mouseenter', {bubbles: false}));
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);

		// Advance past INTENT_DELAY_MS (60ms)
		act(() => {
			vi.advanceTimersByTime(65);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);
	});

	it('cancels left hover peeking if mouse leaves before intent delay', async () => {
		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--6" />);
		});

		const leftSensor = container.querySelector('div[class*="sensorLeftEdge"]') as HTMLDivElement;
		expect(leftSensor).not.toBeNull();

		act(() => {
			leftSensor.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, relatedTarget: null}));
		});

		// Move mouse out after 20ms
		act(() => {
			vi.advanceTimersByTime(20);
			leftSensor.dispatchEvent(new MouseEvent('mouseout', {bubbles: true, relatedTarget: document.body}));
		});

		// Advance past 60ms
		act(() => {
			vi.advanceTimersByTime(60);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
	});

	it('retracts left hover peeking when pointer moves beyond threshold for RETRACT_GRACE_MS', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--7" />);
		});

		// Pointer move far past left threshold (e.g. x = 500)
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 500}));
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);

		// Advance past RETRACT_GRACE_MS (80ms)
		act(() => {
			vi.advanceTimersByTime(85);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
	});

	it('cancels retract timer if pointer moves back inside threshold', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--8" />);
		});

		// Move out
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 500}));
		});

		// Move back in before 80ms
		act(() => {
			vi.advanceTimersByTime(40);
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 50}));
		});

		// Advance remaining time
		act(() => {
			vi.advanceTimersByTime(60);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);
	});

	it('activates and retracts right hover peeking', async () => {
		runInAction(() => {
			LayoutState.setCanRightPeek(true);
			MemberList.isMembersOpen = false;
			LayoutState.setRightHoverPeeking(false);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--9" />);
		});

		const rightSensor = container.querySelector('div[class*="sensorRightEdge"]') as HTMLDivElement;
		expect(rightSensor).not.toBeNull();

		// Enter right sensor
		act(() => {
			rightSensor.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, relatedTarget: null}));
		});

		act(() => {
			vi.advanceTimersByTime(65);
		});

		expect(LayoutState.isRightHoverPeeking).toBe(true);

		// Move pointer to the left (e.g. clientX = 100, far below rightThreshold)
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 100}));
		});

		act(() => {
			vi.advanceTimersByTime(85);
		});

		expect(LayoutState.isRightHoverPeeking).toBe(false);
	});

	it('closes both left and right peeking when Escape key is pressed', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
			LayoutState.setRightHoverPeeking(true);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--10" />);
		});

		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
		expect(LayoutState.isRightHoverPeeking).toBe(false);
	});
});
