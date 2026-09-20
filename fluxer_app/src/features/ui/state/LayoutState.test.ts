// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import AppStorage from '@app/features/platform/state/PersistentStorage';
import * as LayoutCommands from '@app/features/ui/commands/LayoutCommands';
import LayoutState from '@app/features/ui/state/LayoutState';
import {describe, expect, it} from 'vitest';

describe('LayoutState and LayoutCommands', () => {
	it('has correct default visibility and peek states', () => {
		expect(LayoutState.leftSidebarVisible).toBe(true);
		expect(LayoutState.serverListVisible).toBe(true);
		expect(LayoutState.channelListVisible).toBe(true);
		expect(LayoutState.edgeHoverPeekEnabled).toBe(true);
		expect(LayoutState.isLeftHoverPeeking).toBe(false);
		expect(LayoutState.isRightHoverPeeking).toBe(false);
	});

	it('toggles and persists left sidebar visibility', () => {
		LayoutCommands.toggleLeftSidebar();
		expect(LayoutState.leftSidebarVisible).toBe(false);
		expect(LayoutState.serverListVisible).toBe(false);
		expect(LayoutState.channelListVisible).toBe(false);
		expect(AppStorage.getItem('fluxer:ui:left-sidebar-visible')).toBe('false');

		LayoutCommands.toggleLeftSidebar();
		expect(LayoutState.leftSidebarVisible).toBe(true);
		expect(LayoutState.serverListVisible).toBe(true);
		expect(LayoutState.channelListVisible).toBe(true);
		expect(AppStorage.getItem('fluxer:ui:left-sidebar-visible')).toBe('true');
	});

	it('supports legacy toggleServerList and toggleChannelList as forwarding aliases', () => {
		LayoutCommands.toggleServerList();
		expect(LayoutState.leftSidebarVisible).toBe(false);

		LayoutCommands.toggleChannelList();
		expect(LayoutState.leftSidebarVisible).toBe(true);
	});

	it('toggles and persists edge hover peek preference', () => {
		LayoutCommands.setEdgeHoverPeekEnabled(false);
		expect(LayoutState.edgeHoverPeekEnabled).toBe(false);
		expect(AppStorage.getItem('fluxer:ui:edge-hover-peek-enabled')).toBe('false');

		LayoutCommands.setEdgeHoverPeekEnabled(true);
		expect(LayoutState.edgeHoverPeekEnabled).toBe(true);
		expect(AppStorage.getItem('fluxer:ui:edge-hover-peek-enabled')).toBe('true');
	});

	it('updates transient left and right hover peek states', () => {
		LayoutState.setLeftHoverPeeking(true);
		expect(LayoutState.isLeftHoverPeeking).toBe(true);

		LayoutState.setLeftHoverPeeking(false);
		expect(LayoutState.isLeftHoverPeeking).toBe(false);

		LayoutState.setRightHoverPeeking(true);
		expect(LayoutState.isRightHoverPeeking).toBe(true);

		LayoutState.setRightHoverPeeking(false);
		expect(LayoutState.isRightHoverPeeking).toBe(false);
	});

	it('updates canRightPeek and resets isRightHoverPeeking when disabled', () => {
		expect(LayoutState.canRightPeek).toBe(false);

		LayoutState.setCanRightPeek(true);
		expect(LayoutState.canRightPeek).toBe(true);

		LayoutState.setRightHoverPeeking(true);
		expect(LayoutState.isRightHoverPeeking).toBe(true);

		LayoutState.setCanRightPeek(false);
		expect(LayoutState.canRightPeek).toBe(false);
		expect(LayoutState.isRightHoverPeeking).toBe(false);
	});
});
