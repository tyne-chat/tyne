// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork imports.

import Bowser from 'bowser';

const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

const getPlatformType = (): string => {
	if (!userAgent) return 'desktop';
	try {
		return Bowser.getParser(userAgent).getPlatformType() || 'desktop';
	} catch {
		return 'desktop';
	}
};

const platformType = getPlatformType();

const isIPadOS = typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

const isIOSDevice = /iPad|iPhone|iPod/i.test(userAgent) || isIPadOS;
const isElectron =
	typeof window !== 'undefined' &&
	(
		window as {
			electron?: unknown;
		}
	).electron !== undefined;
const isIOSWeb = isIOSDevice && !isElectron;
const isPWA =
	typeof window !== 'undefined' &&
	(window.matchMedia?.('(display-mode: standalone)').matches ||
		(
			navigator as {
				standalone?: boolean;
			}
		).standalone === true);

const isMobileDevice = platformType === 'mobile';
const isTabletDevice = platformType === 'tablet' || isIPadOS;
const isMobileBrowser = isMobileDevice || isTabletDevice;
const isDesktop = !isMobileBrowser;

export const Platform = {
	isElectron,
	isIOSWeb,
	isPWA,
	isMobileBrowser,
	isMobileDevice,
	isTabletDevice,
	isDesktop,
};

export function getNativeLocaleIdentifier(): string | null {
	const languages = navigator.languages;
	if (Array.isArray(languages) && languages.length > 0) {
		return languages[0];
	}
	return navigator.language ?? null;
}
