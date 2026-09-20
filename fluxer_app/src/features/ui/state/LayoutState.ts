// SPDX-License-Identifier: AGPL-3.0-or-later

import AppStorage from '@app/features/platform/state/PersistentStorage';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {makeAutoObservable} from 'mobx';

const logger = new Logger('LayoutState');

const LEFT_SIDEBAR_VISIBLE_STORAGE_KEY = 'fluxer:ui:left-sidebar-visible';
const SERVER_LIST_VISIBLE_STORAGE_KEY = 'fluxer:ui:server-list-visible';
const CHANNEL_LIST_VISIBLE_STORAGE_KEY = 'fluxer:ui:channel-list-visible';
const EDGE_HOVER_PEEK_ENABLED_STORAGE_KEY = 'fluxer:ui:edge-hover-peek-enabled';

function getInitialBoolean(key: string, defaultValue: boolean): boolean {
	const stored = AppStorage.getItem(key);
	if (stored === null || stored === '') return defaultValue;
	return stored === 'true';
}

function getInitialLeftSidebarVisible(): boolean {
	const stored = AppStorage.getItem(LEFT_SIDEBAR_VISIBLE_STORAGE_KEY);
	if (stored !== null && stored !== '') return stored === 'true';
	const legacyChannel = AppStorage.getItem(CHANNEL_LIST_VISIBLE_STORAGE_KEY);
	if (legacyChannel !== null && legacyChannel !== '') return legacyChannel === 'true';
	const legacyServer = AppStorage.getItem(SERVER_LIST_VISIBLE_STORAGE_KEY);
	if (legacyServer !== null && legacyServer !== '') return legacyServer === 'true';
	return true;
}

class LayoutState {
	leftSidebarVisible: boolean = getInitialLeftSidebarVisible();
	edgeHoverPeekEnabled: boolean = getInitialBoolean(EDGE_HOVER_PEEK_ENABLED_STORAGE_KEY, true);

	// Transient hover peek states (active during edge proximity, not persisted)
	isLeftHoverPeeking: boolean = false;
	isRightHoverPeeking: boolean = false;
	canRightPeek: boolean = false;

	get serverListVisible(): boolean {
		return this.leftSidebarVisible;
	}

	get channelListVisible(): boolean {
		return this.leftSidebarVisible;
	}

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	toggleLeftSidebar(): void {
		this.leftSidebarVisible = !this.leftSidebarVisible;
		AppStorage.setItem(LEFT_SIDEBAR_VISIBLE_STORAGE_KEY, String(this.leftSidebarVisible));
		logger.debug(`Toggled left sidebar: ${this.leftSidebarVisible}`);
	}

	setLeftSidebarVisible(value: boolean): void {
		if (this.leftSidebarVisible === value) return;
		this.leftSidebarVisible = value;
		AppStorage.setItem(LEFT_SIDEBAR_VISIBLE_STORAGE_KEY, String(value));
		logger.debug(`Set left sidebar visible: ${value}`);
	}

	toggleServerList(): void {
		this.toggleLeftSidebar();
	}

	setServerListVisible(value: boolean): void {
		this.setLeftSidebarVisible(value);
	}

	toggleChannelList(): void {
		this.toggleLeftSidebar();
	}

	setChannelListVisible(value: boolean): void {
		this.setLeftSidebarVisible(value);
	}

	setEdgeHoverPeekEnabled(value: boolean): void {
		if (this.edgeHoverPeekEnabled === value) return;
		this.edgeHoverPeekEnabled = value;
		AppStorage.setItem(EDGE_HOVER_PEEK_ENABLED_STORAGE_KEY, String(value));
		if (!value) {
			this.isLeftHoverPeeking = false;
			this.isRightHoverPeeking = false;
		}
		logger.debug(`Set edge hover peek enabled: ${value}`);
	}

	setLeftHoverPeeking(value: boolean): void {
		if (this.isLeftHoverPeeking !== value) {
			this.isLeftHoverPeeking = value;
		}
	}

	setRightHoverPeeking(value: boolean): void {
		if (this.isRightHoverPeeking !== value) {
			this.isRightHoverPeeking = value;
		}
	}

	setCanRightPeek(value: boolean): void {
		if (this.canRightPeek !== value) {
			this.canRightPeek = value;
			if (!value && this.isRightHoverPeeking) {
				this.isRightHoverPeeking = false;
			}
		}
	}
}

export default new LayoutState();
