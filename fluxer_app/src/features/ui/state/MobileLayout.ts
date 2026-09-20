// SPDX-License-Identifier: AGPL-3.0-or-later

import {Platform} from '@app/features/platform/types/Platform';
import {deferUntilModulesLoaded} from '@app/features/platform/utils/DeferUntilModulesLoaded';
import {makePersistent} from '@app/features/platform/utils/MobXPersistence';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import Window from '@app/features/window/state/Window';
import {makeAutoObservable, reaction} from 'mobx';

const MOBILE_ENABLE_BREAKPOINT = 640;
const MOBILE_DISABLE_BREAKPOINT = 768;

const shouldForceMobileLayout = (): boolean => Platform.isMobileDevice;

const getInitialMobileEnabled = (): boolean => {
	// Mobile phones always use mobile layout
	if (Platform.isMobileDevice) {
		return true;
	}
	// Tablets switch based on viewport width (portrait vs landscape)
	if (Platform.isTabletDevice) {
		return typeof window !== 'undefined' && window.innerWidth < MOBILE_ENABLE_BREAKPOINT;
	}
	// Desktop computers never use mobile layout regardless of window width
	return false;
};

class MobileLayout {
	navExpanded = true;
	chatExpanded = false;
	enabled = getInitialMobileEnabled();

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
		initializeStore(this, () => this.initPersistence());
		this.initWindowSync();
	}

	private async initPersistence(): Promise<void> {
		await makePersistent(this, 'MobileLayout', ['navExpanded', 'chatExpanded']);
	}

	private initWindowSync(): void {
		deferUntilModulesLoaded(() => {
			this.handleWindowSizeChange();
			reaction(
				() => Window.windowSize,
				() => this.handleWindowSizeChange(),
				{fireImmediately: false},
			);
		});
	}

	isEnabled() {
		return this.enabled;
	}

	private handleWindowSizeChange(): void {
		// Desktop computers never switch to mobile layout based on window width
		if (!Platform.isMobileDevice && !Platform.isTabletDevice) {
			if (this.enabled) {
				this.enabled = false;
			}
			return;
		}

		// Mobile phones always stay in mobile layout
		if (Platform.isMobileDevice) {
			if (!this.enabled) {
				this.enabled = true;
				this.navExpanded = this.navExpanded && !this.chatExpanded;
			}
			return;
		}

		// Tablets (portrait vs landscape) use width thresholds
		const windowSize = Window.windowSize;
		const threshold = this.enabled ? MOBILE_DISABLE_BREAKPOINT : MOBILE_ENABLE_BREAKPOINT;
		const widthBased = windowSize.width < threshold;
		if (widthBased === this.enabled) {
			return;
		}
		this.enabled = widthBased;
		if (widthBased) {
			this.navExpanded = this.navExpanded && !this.chatExpanded;
		}
	}

	updateState(data: {navExpanded?: boolean; chatExpanded?: boolean}): void {
		const hasChanges =
			(data.navExpanded !== undefined && data.navExpanded !== this.navExpanded) ||
			(data.chatExpanded !== undefined && data.chatExpanded !== this.chatExpanded);
		if (!hasChanges) {
			return;
		}
		if (data.navExpanded !== undefined) {
			this.navExpanded = data.navExpanded;
			if (data.navExpanded && this.enabled && this.chatExpanded) {
				this.chatExpanded = false;
			}
		}
		if (data.chatExpanded !== undefined) {
			this.chatExpanded = data.chatExpanded;
			if (data.chatExpanded && this.enabled && this.navExpanded) {
				this.navExpanded = false;
			}
		}
	}

	isMobileLayout(): boolean {
		return this.enabled;
	}

	get platformMobileDetected(): boolean {
		return shouldForceMobileLayout();
	}
}

export default new MobileLayout();
