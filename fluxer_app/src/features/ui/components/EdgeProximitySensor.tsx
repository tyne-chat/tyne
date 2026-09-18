// SPDX-License-Identifier: AGPL-3.0-or-later

import MemberList from '@app/features/member/state/MemberList';
import styles from '@app/features/ui/components/EdgeProximitySensor.module.css';
import LayoutState from '@app/features/ui/state/LayoutState';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import SidebarWidth, {SIDEBAR_WIDTH_DEFAULT} from '@app/features/ui/state/SidebarWidth';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef} from 'react';

const INTENT_DELAY_MS = 60;
const CURSOR_WIDTH_PX = 18;
const RETRACT_GRACE_MS = 80;

export const EdgeProximitySensor: React.FC = observer(() => {
	const isMobile = MobileLayout.enabled;
	const {edgeHoverPeekEnabled, serverListVisible, channelListVisible, isLeftHoverPeeking, isRightHoverPeeking} =
		LayoutState;
	const isMembersOpen = MemberList.isMembersOpen;

	const leftTimerRef = useRef<number | null>(null);
	const rightTimerRef = useRef<number | null>(null);
	const leftRetractTimerRef = useRef<number | null>(null);
	const rightRetractTimerRef = useRef<number | null>(null);

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
			const x = e.clientX;
			const windowWidth = window.innerWidth;

			// Left peek monitoring
			if (LayoutState.isLeftHoverPeeking) {
				const currentSidebarWidth = SidebarWidth.width ?? SIDEBAR_WIDTH_DEFAULT;
				const leftDrawerWidth = 72 + (!LayoutState.channelListVisible ? currentSidebarWidth : 0);
				const leftThreshold = leftDrawerWidth + CURSOR_WIDTH_PX;

				if (x > Math.max(leftThreshold, 100)) {
					if (leftRetractTimerRef.current === null) {
						leftRetractTimerRef.current = window.setTimeout(() => {
							LayoutState.setLeftHoverPeeking(false);
							leftRetractTimerRef.current = null;
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
				const rightThreshold = windowWidth - 264 - CURSOR_WIDTH_PX;

				if (x < rightThreshold) {
					if (rightRetractTimerRef.current === null) {
						rightRetractTimerRef.current = window.setTimeout(() => {
							LayoutState.setRightHoverPeeking(false);
							rightRetractTimerRef.current = null;
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
			if (e.key === 'Escape') {
				LayoutState.setLeftHoverPeeking(false);
				LayoutState.setRightHoverPeeking(false);
			}
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
		if (leftTimerRef.current !== null) return;
		leftTimerRef.current = window.setTimeout(() => {
			LayoutState.setLeftHoverPeeking(true);
			leftTimerRef.current = null;
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
		if (rightTimerRef.current !== null) return;
		rightTimerRef.current = window.setTimeout(() => {
			LayoutState.setRightHoverPeeking(true);
			rightTimerRef.current = null;
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

	const showLeftEdgeSensor = !serverListVisible && !isLeftHoverPeeking;
	const showLeftSeamSensor = serverListVisible && !channelListVisible && !isLeftHoverPeeking;
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
			{showLeftSeamSensor && (
				<div
					className={styles.sensorLeftSeam}
					onMouseEnter={handleLeftSensorEnter}
					onMouseLeave={handleLeftSensorLeave}
					aria-hidden="true"
					data-flx="ui.edge-proximity-sensor.sensor-left-seam"
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
