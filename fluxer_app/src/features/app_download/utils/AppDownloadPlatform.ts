// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: which of Tyne's apps a visitor should be offered, and the links to them (tyne-chat/tyne#242).
// The links are the app proxy's fixed ones (`fluxer_app_proxy/src/routes/fork_downloads.rs`), which
// redirect to the newest release's file, so nothing here knows a version or asks GitHub.

export type AppPlatform = 'windows' | 'mac' | 'linux' | 'android' | 'ios';

export type AppDownloadTarget = 'windows' | 'mac' | 'linux-deb' | 'linux-rpm' | 'linux-appimage' | 'android';

export const APP_PLATFORMS: ReadonlyArray<AppPlatform> = ['windows', 'mac', 'linux', 'android', 'ios'];

export const APP_DOWNLOAD_PAGE_PATH = '/download';

// The public link of the iPhone app's TestFlight beta (App Store Connect, group "Beta testers").
export const IOS_TESTFLIGHT_URL = 'https://testflight.apple.com/join/MJtxfkND';

// Where earlier versions are, per platform; TestFlight offers none.
export const OLDER_VERSIONS_URLS: Record<AppPlatform, string | null> = {
	windows: 'https://github.com/tyne-chat/tyne/releases',
	mac: 'https://github.com/tyne-chat/tyne/releases',
	linux: 'https://github.com/tyne-chat/tyne/releases',
	android: 'https://github.com/tyne-chat/tyne-mobile/releases',
	ios: null,
};

export interface BrowserPlatformHints {
	readonly userAgent: string;
	// `navigator.userAgentData.platform` where the browser has it (Chromium): "Windows", "macOS", ...
	readonly platform?: string;
	readonly maxTouchPoints?: number;
}

export function detectAppPlatform({
	userAgent,
	platform = '',
	maxTouchPoints = 0,
}: BrowserPlatformHints): AppPlatform | null {
	// iPads ask for the desktop site and say "Macintosh"; only the touch screen gives them away.
	if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
		return 'ios';
	}
	if (/Android/i.test(userAgent) || /^Android$/i.test(platform)) {
		return 'android';
	}
	// ChromeOS can run Android and Linux apps; neither is a safe guess, so it gets the full list.
	if (/CrOS/i.test(userAgent) || /^Chrome ?OS$/i.test(platform)) {
		return null;
	}
	if (/^Windows$/i.test(platform) || /Windows/i.test(userAgent)) {
		return 'windows';
	}
	if (/^macOS$/i.test(platform) || /Macintosh|Mac OS X/i.test(userAgent)) {
		return 'mac';
	}
	if (/^Linux$/i.test(platform) || /Linux|X11/i.test(userAgent)) {
		return 'linux';
	}
	return null;
}

interface NavigatorWithUserAgentData {
	readonly userAgent: string;
	readonly maxTouchPoints?: number;
	readonly userAgentData?: {readonly platform?: string};
}

export function readBrowserPlatformHints(): BrowserPlatformHints {
	if (typeof navigator === 'undefined') {
		return {userAgent: ''};
	}
	const nav = navigator as NavigatorWithUserAgentData;
	return {userAgent: nav.userAgent, platform: nav.userAgentData?.platform, maxTouchPoints: nav.maxTouchPoints};
}

export function detectBrowserAppPlatform(): AppPlatform | null {
	return detectAppPlatform(readBrowserPlatformHints());
}

export function isPhonePlatform(platform: AppPlatform | null): boolean {
	return platform === 'android' || platform === 'ios';
}

export function parseAppPlatform(value: string | null | undefined): AppPlatform | null {
	return APP_PLATFORMS.find((platform) => platform === value) ?? null;
}

export function parseAppDownloadTarget(value: string | null | undefined): AppDownloadTarget | null {
	switch (value) {
		case 'windows':
		case 'mac':
		case 'linux-deb':
		case 'linux-rpm':
		case 'linux-appimage':
		case 'android':
			return value;
		default:
			return null;
	}
}

export function platformOfTarget(target: AppDownloadTarget): AppPlatform {
	switch (target) {
		case 'windows':
		case 'mac':
		case 'android':
			return target;
		default:
			return 'linux';
	}
}

/** The one file a platform's main button downloads, if it has exactly one. */
export function mainTargetOf(platform: AppPlatform): AppDownloadTarget | null {
	switch (platform) {
		case 'windows':
		case 'mac':
		case 'android':
			return platform;
		default:
			return null;
	}
}

export function appDownloadLink(target: AppDownloadTarget): string {
	return `${APP_DOWNLOAD_PAGE_PATH}/${target}`;
}

/** The page that starts `target`'s download and shows how to install it. */
export function appDownloadPageLink(target?: AppDownloadTarget | null): string {
	return target == null ? APP_DOWNLOAD_PAGE_PATH : `${APP_DOWNLOAD_PAGE_PATH}?get=${target}`;
}

export function absoluteAppDownloadPageUrl(origin: string = currentOrigin()): string {
	return `${origin}${APP_DOWNLOAD_PAGE_PATH}`;
}

/** The QR code's address: the page, opened on the phone platform shown if one is. */
export function phoneQrCodeUrl(platform: AppPlatform | null, origin: string = currentOrigin()): string {
	const page = absoluteAppDownloadPageUrl(origin);
	return isPhonePlatform(platform) ? `${page}?platform=${platform}` : page;
}

function currentOrigin(): string {
	return typeof window === 'undefined' ? '' : window.location.origin;
}

/**
 * Tyne's download page for upstream's `DESKTOP_DOWNLOAD_URL`, which points at Fluxer's
 * (tyne-chat/tyne#558). The desktop app loads the web app from the instance, so the page's origin
 * is the instance in both. Null where there is no page origin (tests without a window).
 */
export function forkAppDownloadPageUrl(): string | null {
	const origin = currentOrigin();
	return origin.startsWith('http') ? absoluteAppDownloadPageUrl(origin) : null;
}
