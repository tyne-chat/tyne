// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {
	appDownloadLink,
	appDownloadPageLink,
	detectAppPlatform,
	forkAppDownloadPageUrl,
	mainTargetOf,
	parseAppDownloadTarget,
	parseAppPlatform,
	phoneQrCodeUrl,
	platformOfTarget,
} from '@app/features/app_download/utils/AppDownloadPlatform';
import {describe, expect, it} from 'vitest';

const UA = {
	windows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
	linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
	android:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
	chromeOS:
		'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};

describe('detectAppPlatform', () => {
	it('recognises each platform from its user agent', () => {
		expect(detectAppPlatform({userAgent: UA.windows})).toBe('windows');
		expect(detectAppPlatform({userAgent: UA.macSafari})).toBe('mac');
		expect(detectAppPlatform({userAgent: UA.linuxFirefox})).toBe('linux');
		expect(detectAppPlatform({userAgent: UA.android})).toBe('android');
		expect(detectAppPlatform({userAgent: UA.iphone})).toBe('ios');
	});

	it('takes an Android phone for Android, not Linux, although its user agent says Linux', () => {
		expect(detectAppPlatform({userAgent: UA.android, platform: 'Android'})).toBe('android');
	});

	it('takes an iPad asking for the desktop site for iOS, by its touch screen', () => {
		expect(detectAppPlatform({userAgent: UA.macSafari, maxTouchPoints: 5})).toBe('ios');
		expect(detectAppPlatform({userAgent: UA.macSafari, maxTouchPoints: 0})).toBe('mac');
	});

	it('prefers the client hints platform where the browser has one', () => {
		expect(detectAppPlatform({userAgent: 'Mozilla/5.0', platform: 'Windows'})).toBe('windows');
		expect(detectAppPlatform({userAgent: 'Mozilla/5.0', platform: 'macOS'})).toBe('mac');
		expect(detectAppPlatform({userAgent: 'Mozilla/5.0', platform: 'Linux'})).toBe('linux');
	});

	it('makes no guess for ChromeOS or an unknown browser', () => {
		expect(detectAppPlatform({userAgent: UA.chromeOS})).toBeNull();
		expect(detectAppPlatform({userAgent: 'Mozilla/5.0', platform: 'Chrome OS'})).toBeNull();
		expect(detectAppPlatform({userAgent: ''})).toBeNull();
	});
});

describe('download links', () => {
	it('links each file to the app proxy`s fixed address', () => {
		expect(appDownloadLink('windows')).toBe('/download/windows');
		expect(appDownloadLink('linux-appimage')).toBe('/download/linux-appimage');
		expect(appDownloadPageLink()).toBe('/download');
		expect(appDownloadPageLink('mac')).toBe('/download?get=mac');
	});

	it('gives a main file only to platforms with exactly one', () => {
		expect(mainTargetOf('windows')).toBe('windows');
		expect(mainTargetOf('mac')).toBe('mac');
		expect(mainTargetOf('android')).toBe('android');
		expect(mainTargetOf('linux')).toBeNull();
		expect(mainTargetOf('ios')).toBeNull();
	});

	it('accepts only known values from the address', () => {
		expect(parseAppDownloadTarget('linux-rpm')).toBe('linux-rpm');
		expect(parseAppDownloadTarget('ios')).toBeNull();
		expect(parseAppDownloadTarget('../x')).toBeNull();
		expect(parseAppDownloadTarget(null)).toBeNull();
		expect(parseAppPlatform('ios')).toBe('ios');
		expect(parseAppPlatform('linux-rpm')).toBeNull();
		expect(platformOfTarget('linux-deb')).toBe('linux');
		expect(platformOfTarget('android')).toBe('android');
	});

	it('points the web app`s download links at this instance`s page', () => {
		expect(forkAppDownloadPageUrl()).toBe(`${window.location.origin}/download`);
	});

	it('opens the phone platform shown when the QR code is scanned', () => {
		expect(phoneQrCodeUrl('android', 'https://chat.example')).toBe('https://chat.example/download?platform=android');
		expect(phoneQrCodeUrl('ios', 'https://chat.example')).toBe('https://chat.example/download?platform=ios');
		expect(phoneQrCodeUrl('windows', 'https://chat.example')).toBe('https://chat.example/download');
		expect(phoneQrCodeUrl(null, 'https://chat.example')).toBe('https://chat.example/download');
	});
});
