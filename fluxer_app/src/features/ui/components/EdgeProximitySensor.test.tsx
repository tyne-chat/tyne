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

let mockHasLayers = false;
let mockHasContextMenu = false;

vi.mock('@app/features/ui/state/LayerManager', () => ({
	default: {
		hasLayers: () => mockHasLayers,
	},
}));

vi.mock('@app/features/ui/state/ContextMenu', () => ({
	default: {
		get contextMenu() {
			return mockHasContextMenu
				? ({id: 'mock-menu'} as unknown as import('@app/features/ui/state/ContextMenu').ContextMenu)
				: null;
		},
	},
}));

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {EdgeProximitySensor} = await import('./EdgeProximitySensor');

describe('EdgeProximitySensor', () => {
	let container: HTMLDivElement;
	let root: Root;
	const originalElementFromPoint = document.elementFromPoint;

	function createMockDrawer(side: 'left' | 'right', bounds: {left: number; right: number}) {
		const el = document.createElement('div');
		el.setAttribute('data-peek-drawer', side);
		el.getBoundingClientRect = () => ({
			left: bounds.left,
			top: 0,
			right: bounds.right,
			bottom: 1000,
			width: bounds.right - bounds.left,
			height: 1000,
			x: bounds.left,
			y: 0,
			toJSON: () => {},
		});
		document.body.appendChild(el);
		return el;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		mockHasLayers = false;
		mockHasContextMenu = false;
		document.documentElement.classList.add('window-focused');
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
		document.elementFromPoint = originalElementFromPoint;
		document.documentElement.classList.remove('window-focused', 'window-focus-activation-guard');
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

	async function hoverLeftSensor() {
		await act(async () => {
			root.render(
				<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.hover-left-sensor.edge-proximity-sensor" />,
			);
		});
		const leftSensor = container.querySelector('div[class*="sensorLeftEdge"]') as HTMLDivElement;
		act(() => {
			leftSensor.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, relatedTarget: null}));
		});
	}

	it('does not peek when the window is not focused', async () => {
		document.documentElement.classList.remove('window-focused');
		await hoverLeftSensor();

		act(() => {
			vi.advanceTimersByTime(100);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
	});

	it('does not peek if the window loses focus during the intent delay', async () => {
		await hoverLeftSensor();

		document.documentElement.classList.remove('window-focused');
		act(() => {
			vi.advanceTimersByTime(100);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
	});

	it('does not peek while the window focus activation guard is active', async () => {
		document.documentElement.classList.add('window-focus-activation-guard');
		await hoverLeftSensor();

		act(() => {
			vi.advanceTimersByTime(100);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
	});

	it('peeks in an unfocused window when unfocused-fully-interactive is enabled', async () => {
		document.documentElement.classList.remove('window-focused');
		document.documentElement.classList.add('unfocused-fully-interactive');
		try {
			await hoverLeftSensor();

			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(LayoutState.isLeftHoverPeeking).toBe(true);
		} finally {
			document.documentElement.classList.remove('unfocused-fully-interactive');
		}
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

		createMockDrawer('left', {left: 0, right: 392});

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

		createMockDrawer('left', {left: 0, right: 392});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--8" />);
		});

		// Move out past drawer right + CURSOR_WIDTH_PX (392 + 18 = 410)
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 500}));
		});

		// Move back inside before 80ms
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

		createMockDrawer('right', {left: 800, right: 1024});

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

		// Move pointer to the left (e.g. clientX = 100, far below right drawer left)
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 100}));
		});

		act(() => {
			vi.advanceTimersByTime(85);
		});

		expect(LayoutState.isRightHoverPeeking).toBe(false);
	});

	it('does not retract left peeking when modal or popout layer is active', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		createMockDrawer('left', {left: 0, right: 392});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--10" />);
		});

		mockHasLayers = true;

		// Pointer move far past left drawer
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 600}));
		});

		act(() => {
			vi.advanceTimersByTime(100);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);
	});

	it('does not retract left peeking when context menu is active', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		createMockDrawer('left', {left: 0, right: 392});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--11" />);
		});

		mockHasContextMenu = true;

		// Pointer move far past left drawer
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 600}));
		});

		act(() => {
			vi.advanceTimersByTime(100);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);
	});

	it('closes both left and right peeking when Escape key is pressed', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
			LayoutState.setRightHoverPeeking(true);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--12" />);
		});

		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
		expect(LayoutState.isRightHoverPeeking).toBe(false);
	});

	it('keeps left peek open when pointer moves over an element inside data-peek-drawer="left"', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		// Create a mock drawer element in the document
		const drawer = document.createElement('div');
		drawer.setAttribute('data-peek-drawer', 'left');
		const settingsButton = document.createElement('button');
		drawer.appendChild(settingsButton);
		document.body.appendChild(drawer);

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--13" />);
		});

		// Pointer move directly targeting the settings button at high X (e.g. 550)
		act(() => {
			settingsButton.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, clientX: 550}));
		});

		act(() => {
			vi.advanceTimersByTime(100);
		});

		// Should remain open because target is inside data-peek-drawer="left"
		expect(LayoutState.isLeftHoverPeeking).toBe(true);
	});

	it('uses measured DOM drawer bounding rect to extend threshold without zoom math', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		// Wide drawer, e.g. what the desktop client produces at 150% zoom
		createMockDrawer('left', {left: 0, right: 588});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--14" />);
		});

		// x = 550 is inside 588 + cursor slack
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 550}));
		});

		act(() => {
			vi.advanceTimersByTime(100);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);

		// x = 650 is beyond 588 + cursor slack
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 650}));
		});

		act(() => {
			vi.advanceTimersByTime(85);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
	});

	it('keeps right peek open within cursor slack of the measured right drawer edge', async () => {
		runInAction(() => {
			LayoutState.setRightHoverPeeking(true);
		});

		createMockDrawer('right', {left: 800, right: 1024});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--15" />);
		});

		// Just left of the drawer edge, inside cursor slack
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 790}));
		});

		act(() => {
			vi.advanceTimersByTime(100);
		});

		expect(LayoutState.isRightHoverPeeking).toBe(true);
	});

	it('ignores zero-width drawers and retracts when no measurable drawer exists', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		createMockDrawer('left', {left: 0, right: 0});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--16" />);
		});

		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 10}));
		});

		act(() => {
			vi.advanceTimersByTime(85);
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(false);
	});

	it('does not collapse peeked drawers on Escape while a context menu or layer is open', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
			LayoutState.setRightHoverPeeking(true);
		});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--17" />);
		});

		mockHasContextMenu = true;
		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);
		expect(LayoutState.isRightHoverPeeking).toBe(true);

		mockHasContextMenu = false;
		mockHasLayers = true;
		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
		});

		expect(LayoutState.isLeftHoverPeeking).toBe(true);
		expect(LayoutState.isRightHoverPeeking).toBe(true);
	});

	it('aborts retraction when elementFromPoint on timer expiry detects drawer', async () => {
		runInAction(() => {
			LayoutState.setLeftHoverPeeking(true);
		});

		// Drawer is still zero-width (mid slide-in animation)
		const drawer = createMockDrawer('left', {left: 0, right: 0});

		await act(async () => {
			root.render(<EdgeProximitySensor data-flx="ui.edge-proximity-sensor-test.edge-proximity-sensor--18" />);
		});

		document.elementFromPoint = () => null;

		// Move to x = 500 (triggers timer because the drawer is not yet under the cursor)
		act(() => {
			window.dispatchEvent(new PointerEvent('pointermove', {clientX: 500, clientY: 300}));
		});

		// Drawer animation completes: elementFromPoint now returns the drawer
		document.elementFromPoint = (x: number, y: number) => (x === 500 && y === 300 ? drawer : null);

		act(() => {
			vi.advanceTimersByTime(85);
		});

		// Retraction aborted because the drawer is now under the stationary cursor
		expect(LayoutState.isLeftHoverPeeking).toBe(true);
	});
});
