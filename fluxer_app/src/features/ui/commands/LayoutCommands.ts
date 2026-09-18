// SPDX-License-Identifier: AGPL-3.0-or-later

import MemberList from '@app/features/member/state/MemberList';
import {Logger} from '@app/features/platform/utils/AppLogger';
import MobileLayout from '@app/features/ui/state/MobileLayout';

// Fork imports.

import LayoutState from '@app/features/ui/state/LayoutState';

const logger = new Logger('Layout');

export function updateMobileLayoutState(navExpanded: boolean, chatExpanded: boolean): void {
	logger.debug(`Updating mobile layout state: nav=${navExpanded}, chat=${chatExpanded}`);
	MobileLayout.updateState({navExpanded, chatExpanded});
}

export function toggleMembers(_isOpen?: boolean): void {
	MemberList.toggleMembers();
}

export function toggleServerList(): void {
	LayoutState.toggleServerList();
}

export function setServerListVisible(visible: boolean): void {
	LayoutState.setServerListVisible(visible);
}

export function toggleChannelList(): void {
	LayoutState.toggleChannelList();
}

export function setChannelListVisible(visible: boolean): void {
	LayoutState.setChannelListVisible(visible);
}

export function setEdgeHoverPeekEnabled(enabled: boolean): void {
	LayoutState.setEdgeHoverPeekEnabled(enabled);
}
