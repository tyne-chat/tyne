// SPDX-License-Identifier: AGPL-3.0-or-later

import AppStorage from '@app/features/platform/state/PersistentStorage';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {makeAutoObservable} from 'mobx';

const logger = new Logger('LayoutState');

const SERVER_LIST_VISIBLE_STORAGE_KEY = 'fluxer:ui:server-list-visible';
const CHANNEL_LIST_VISIBLE_STORAGE_KEY = 'fluxer:ui:channel-list-visible';
const EDGE_HOVER_PEEK_ENABLED_STORAGE_KEY = 'fluxer:ui:edge-hover-peek-enabled';

function getInitialBoolean(key: string, defaultValue: boolean): boolean {
	const stored = AppStorage.getItem(key);
	if (stored === null || stored === '') return defaultValue;
	return stored === 'true';
}

class LayoutState {
	serverListVisible: boolean = getInitialBoolean(SERVER_LIST_VISIBLE_STORAGE_KEY, true);
	channelListVisible: boolean = getInitialBoolean(CHANNEL_LIST_VISIBLE_STORAGE_KEY, true);
	edgeHoverPeekEnabled: boolean = getInitialBoolean(EDGE_HOVER_PEEK_ENABLED_STORAGE_KEY, true);

	// Transient hover peek states (active during edge proximity, not persisted)
	isLeftHoverPeeking: boolean = false;
	isRightHoverPeeking: boolean = false;
	canRightPeek: boolean = false;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	toggleServerList(): void {
		this.serverListVisible = !this.serverListVisible;
		AppStorage.setItem(SERVER_LIST_VISIBLE_STORAGE_KEY, String(this.serverListVisible));
		logger.debug(`Toggled server list: ${this.serverListVisible}`);
	}

	setServerListVisible(value: boolean): void {
		if (this.serverListVisible === value) return;
		this.serverListVisible = value;
		AppStorage.setItem(SERVER_LIST_VISIBLE_STORAGE_KEY, String(value));
		logger.debug(`Set server list visible: ${value}`);
	}

	toggleChannelList(): void {
		this.channelListVisible = !this.channelListVisible;
		AppStorage.setItem(CHANNEL_LIST_VISIBLE_STORAGE_KEY, String(this.channelListVisible));
		logger.debug(`Toggled channel list: ${this.channelListVisible}`);
	}

	setChannelListVisible(value: boolean): void {
		if (this.channelListVisible === value) return;
		this.channelListVisible = value;
		AppStorage.setItem(CHANNEL_LIST_VISIBLE_STORAGE_KEY, String(value));
		logger.debug(`Set channel list visible: ${value}`);
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
