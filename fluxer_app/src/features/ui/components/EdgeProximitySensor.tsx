// SPDX-License-Identifier: AGPL-3.0-or-later

import MemberList from '@app/features/member/state/MemberList';
import styles from '@app/features/ui/components/EdgeProximitySensor.module.css';
import ContextMenuState from '@app/features/ui/state/ContextMenu';
import LayerManager, {LayerType} from '@app/features/ui/state/LayerManager';
import LayoutState from '@app/features/ui/state/LayoutState';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {canUseWindowFocusedHoverControls} from '@app/features/ui/utils/WindowFocusInteractionGuard';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef} from 'react';

// A modal, popout or context menu is open on top of the app.
function hasOpenLayer(): boolean {
	return Object.values(LayerType).some((type) => LayerManager.hasType(type));
}

const INTENT_DELAY_MS = 60;
const CURSOR_WIDTH_PX = 18;
const RETRACT_GRACE_MS = 80;

/**
 * Returns true if the pointer is over (or within CURSOR_WIDTH_PX of) any element tagged
 * `data-peek-drawer="<side>"`. Uses live DOM measurement so it is correct at any zoom level,
 * sidebar width, or theme without hardcoded layout dimensions.
 *
 * @param targetEl The pointer event target when available. When omitted (e.g. on timer expiry,
 *   where the drawer may have animated under a stationary cursor) a fresh hit test is performed.
 */
function isPointerWithinDrawer(side: 'left' | 'right', x: number, y: number, targetEl?: Element | null): boolean {
	const selector = `[data-peek-drawer="${side}"]`;

	// Fast path: the element under the pointer is inside a drawer.
	const hitEl = targetEl !== undefined ? targetEl : document.elementFromPoint?.(x, y);
	if (hitEl?.closest(selector)) {
		return true;
	}

	// Geometry check: measured drawer edge + cursor slack, ignoring collapsed (zero-width) elements.
	let edge: number | null = null;
	for (const el of document.querySelectorAll<HTMLElement>(selector)) {
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0) continue;
		if (side === 'left') {
			edge = edge === null ? rect.right : Math.max(edge, rect.right);
		} else {
			edge = edge === null ? rect.left : Math.min(edge, rect.left);
		}
	}
	if (edge === null) return false;
	return side === 'left' ? x <= edge + CURSOR_WIDTH_PX : x >= edge - CURSOR_WIDTH_PX;
}

export const EdgeProximitySensor: React.FC = observer(() => {
	const isMobile = MobileLayout.enabled;
	const {edgeHoverPeekEnabled, leftSidebarVisible, isLeftHoverPeeking, isRightHoverPeeking} = LayoutState;
	const isMembersOpen = MemberList.isMembersOpen;

	const leftTimerRef = useRef<number | null>(null);
	const rightTimerRef = useRef<number | null>(null);
	const leftRetractTimerRef = useRef<number | null>(null);
	const rightRetractTimerRef = useRef<number | null>(null);
	const lastPointerCoordsRef = useRef<{x: number; y: number} | null>(null);

	const clearLeftTimers = useCallback(() => {
		if (leftTimerRef.current !== null) {
			window.clearTimeout(leftTimerRef.current);
			leftTimerRef.current = null;
		}
		if (leftRetractTimerRef.current !== null) {
			window.clearTimeout(leftRetractTimerRef.current);
			leftRetractTimerRef.current = null;
		}
	}, []);

	const clearRightTimers = useCallback(() => {
		if (rightTimerRef.current !== null) {
			window.clearTimeout(rightTimerRef.current);
			rightTimerRef.current = null;
		}
		if (rightRetractTimerRef.current !== null) {
			window.clearTimeout(rightRetractTimerRef.current);
			rightRetractTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		return () => {
			clearLeftTimers();
			clearRightTimers();
		};
	}, [clearLeftTimers, clearRightTimers]);

	// Mouse pointer monitoring for smooth retraction when leaving the peeked drawer
	useEffect(() => {
		if (!edgeHoverPeekEnabled || isMobile) return;

		const handlePointerMove = (e: PointerEvent) => {
			if (!LayoutState.isLeftHoverPeeking && !LayoutState.isRightHoverPeeking) {
				return;
			}

			lastPointerCoordsRef.current = {x: e.clientX, y: e.clientY};

			// If a modal, popout, or context menu is active, don't retract the peeking drawer
			if (hasOpenLayer() || ContextMenuState.contextMenu !== null) {
				if (leftRetractTimerRef.current !== null) {
					window.clearTimeout(leftRetractTimerRef.current);
					leftRetractTimerRef.current = null;
				}
				if (rightRetractTimerRef.current !== null) {
					window.clearTimeout(rightRetractTimerRef.current);
					rightRetractTimerRef.current = null;
				}
				return;
			}

			const x = e.clientX;
			const y = e.clientY;
			const targetEl = e.target instanceof Element ? e.target : null;

			// Left peek monitoring
			if (LayoutState.isLeftHoverPeeking) {
				if (!isPointerWithinDrawer('left', x, y, targetEl)) {
					if (leftRetractTimerRef.current === null) {
						leftRetractTimerRef.current = window.setTimeout(() => {
							leftRetractTimerRef.current = null;
							if (hasOpenLayer() || ContextMenuState.contextMenu !== null) return;
							const coords = lastPointerCoordsRef.current;
							if (coords && isPointerWithinDrawer('left', coords.x, coords.y)) {
								return;
							}
							LayoutState.setLeftHoverPeeking(false);
						}, RETRACT_GRACE_MS);
					}
				} else {
					if (leftRetractTimerRef.current !== null) {
						window.clearTimeout(leftRetractTimerRef.current);
						leftRetractTimerRef.current = null;
					}
				}
			}

			// Right peek monitoring
			if (LayoutState.isRightHoverPeeking) {
				if (!isPointerWithinDrawer('right', x, y, targetEl)) {
					if (rightRetractTimerRef.current === null) {
						rightRetractTimerRef.current = window.setTimeout(() => {
							rightRetractTimerRef.current = null;
							if (hasOpenLayer() || ContextMenuState.contextMenu !== null) return;
							const coords = lastPointerCoordsRef.current;
							if (coords && isPointerWithinDrawer('right', coords.x, coords.y)) {
								return;
							}
							LayoutState.setRightHoverPeeking(false);
						}, RETRACT_GRACE_MS);
					}
				} else {
					if (rightRetractTimerRef.current !== null) {
						window.clearTimeout(rightRetractTimerRef.current);
						rightRetractTimerRef.current = null;
					}
				}
			}
		};

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			// Let Escape dismiss an open modal/popout/context menu first without collapsing the drawer behind it.
			if (hasOpenLayer() || ContextMenuState.contextMenu !== null) return;
			LayoutState.setLeftHoverPeeking(false);
			LayoutState.setRightHoverPeeking(false);
		};

		window.addEventListener('pointermove', handlePointerMove, {passive: true});
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [edgeHoverPeekEnabled, isMobile]);

	const handleLeftSensorEnter = useCallback(() => {
		if (leftRetractTimerRef.current !== null) {
			window.clearTimeout(leftRetractTimerRef.current);
			leftRetractTimerRef.current = null;
		}
		if (!canUseWindowFocusedHoverControls()) return;
		if (leftTimerRef.current !== null) return;
		leftTimerRef.current = window.setTimeout(() => {
			leftTimerRef.current = null;
			// Re-check: the window may have lost focus during the intent delay.
			if (!canUseWindowFocusedHoverControls()) return;
			LayoutState.setLeftHoverPeeking(true);
		}, INTENT_DELAY_MS);
	}, []);

	const handleLeftSensorLeave = useCallback(() => {
		if (leftTimerRef.current !== null) {
			window.clearTimeout(leftTimerRef.current);
			leftTimerRef.current = null;
		}
	}, []);

	const handleRightSensorEnter = useCallback(() => {
		if (!LayoutState.canRightPeek) return;
		if (rightRetractTimerRef.current !== null) {
			window.clearTimeout(rightRetractTimerRef.current);
			rightRetractTimerRef.current = null;
		}
		if (!canUseWindowFocusedHoverControls()) return;
		if (rightTimerRef.current !== null) return;
		rightTimerRef.current = window.setTimeout(() => {
			rightTimerRef.current = null;
			if (!canUseWindowFocusedHoverControls()) return;
			LayoutState.setRightHoverPeeking(true);
		}, INTENT_DELAY_MS);
	}, []);

	const handleRightSensorLeave = useCallback(() => {
		if (rightTimerRef.current !== null) {
			window.clearTimeout(rightTimerRef.current);
			rightTimerRef.current = null;
		}
	}, []);

	if (!edgeHoverPeekEnabled || isMobile) {
		return null;
	}

	const showLeftEdgeSensor = !leftSidebarVisible && !isLeftHoverPeeking;
	const showRightEdgeSensor = LayoutState.canRightPeek && !isMembersOpen && !isRightHoverPeeking;

	return (
		<>
			{showLeftEdgeSensor && (
				<div
					className={styles.sensorLeftEdge}
					onMouseEnter={handleLeftSensorEnter}
					onMouseLeave={handleLeftSensorLeave}
					aria-hidden="true"
					data-flx="ui.edge-proximity-sensor.sensor-left-edge"
				/>
			)}
			{showRightEdgeSensor && (
				<div
					className={styles.sensorRightEdge}
					onMouseEnter={handleRightSensorEnter}
					onMouseLeave={handleRightSensorLeave}
					aria-hidden="true"
					data-flx="ui.edge-proximity-sensor.sensor-right-edge"
				/>
			)}
		</>
	);
});
